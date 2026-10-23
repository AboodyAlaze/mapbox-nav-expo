/**
 * Config plugin for the local `mapbox-navigation` module.
 *
 *   plugins: [["./modules/mapbox-navigation/app.plugin.js", { "accessToken": "pk.…" }]]
 *
 * The token can also come from the env var MAPBOX_ACCESS_TOKEN (or EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN).
 * It is written into AndroidManifest.xml as <meta-data> and read by the native module at startup.
 */
const {
  withAndroidManifest,
  withProjectBuildGradle,
  withInfoPlist,
  withXcodeProject,
  withPodfileProperties,
  AndroidConfig,
} = require('expo/config-plugins');

const META_KEY = 'com.mapbox.navigation.expo.ACCESS_TOKEN';

const REQUIRED_PERMISSIONS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.INTERNET',
];

const MAVEN_MARKER = 'api.mapbox.com/downloads/v2/releases/maven';

const MAVEN_BLOCK = `
    maven {
      // Mapbox Navigation / Maps SDK (added by mapbox-navigation config plugin)
      url 'https://${MAVEN_MARKER}'
      def mapboxDownloadsToken = project.findProperty('MAPBOX_DOWNLOADS_TOKEN') ?: System.getenv('MAPBOX_DOWNLOADS_TOKEN')
      if (mapboxDownloadsToken) {
        authentication { basic(BasicAuthentication) }
        credentials {
          username = 'mapbox'
          password = mapboxDownloadsToken
        }
      }
    }`;

function addMapboxRepo(contents) {
  // Insert inside `allprojects { repositories { ... } }`
  const re = /(allprojects\s*\{\s*repositories\s*\{)/;
  if (re.test(contents)) {
    return contents.replace(re, `$1${MAVEN_BLOCK}`);
  }
  // Fallback: append a standalone block
  return `${contents}\n\nallprojects {\n  repositories {${MAVEN_BLOCK}\n  }\n}\n`;
}


const EMBED_PHASE_NAME = 'Embed Mapbox frameworks';

// Mapbox ships some binary frameworks (MapboxCommon, MapboxCoreMaps, MapboxNavigationNative) as DYNAMIC frameworks.
// They come from Swift Package Manager and are linked by the pod target, so Xcode does not embed them in the app,
// which crashes at launch with: dyld "Library not loaded: @rpath/MapboxCommon.framework".
// This build phase copies (and signs) every dynamic Mapbox/Turf framework into <App>.app/Frameworks.
const EMBED_SCRIPT = [
  'set -e',
  'FRAMEWORKS_DIR="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"',
  'mkdir -p "$FRAMEWORKS_DIR"',
  'SP_ROOT="${BUILD_DIR}/../../SourcePackages"',
  'embed() {',
  '  fw="$1"',
  '  name="$(basename "$fw" .framework)"',
  '  bin="$fw/$name"',
  '  [ -f "$bin" ] || return 0',
  '  if file -b "$bin" | grep -q "dynamically linked shared library"; then',
  '    if [ -d "$FRAMEWORKS_DIR/$name.framework" ]; then return 0; fi',
  '    echo "Embedding $name.framework"',
  '    rsync -a "$fw" "$FRAMEWORKS_DIR/"',
  '    if [ -n "${EXPANDED_CODE_SIGN_IDENTITY}" ] && [ "${CODE_SIGNING_ALLOWED}" != "NO" ]; then',
  '      /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" --preserve-metadata=identifier,entitlements --timestamp=none "$FRAMEWORKS_DIR/$name.framework"',
  '    fi',
  '  fi',
  '}',
  'for fw in "${BUILT_PRODUCTS_DIR}"/Mapbox*.framework "${BUILT_PRODUCTS_DIR}"/Turf*.framework "${BUILT_PRODUCTS_DIR}"/PackageFrameworks/*.framework; do',
  '  [ -d "$fw" ] && embed "$fw"',
  'done',
  'if [ -d "$SP_ROOT/artifacts" ]; then',
  '  find "$SP_ROOT/artifacts" -type d -name "Mapbox*.framework" | while read fw; do',
  '    case "${PLATFORM_NAME}" in',
  '      iphonesimulator) case "$fw" in *simulator*) embed "$fw";; esac;;',
  '      *) case "$fw" in *simulator*) ;; *ios-arm64*) embed "$fw";; esac;;',
  '    esac',
  '  done',
  'fi',
  'exit 0',
].join('\n');

function addEmbedPhase(project) {
  const target = project.getFirstTarget();
  if (!target) return;

  // Xcode 15+ sandboxes user scripts by default, which would block copying frameworks.
  project.updateBuildProperty('ENABLE_USER_SCRIPT_SANDBOXING', 'NO');

  const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  const exists = Object.values(phases).some(
    (p) => p && typeof p === 'object' && String(p.name || '').includes(EMBED_PHASE_NAME)
  );
  if (exists) return;

  const result = project.addBuildPhase([], 'PBXShellScriptBuildPhase', EMBED_PHASE_NAME, target.uuid, {
    shellPath: '/bin/sh',
    shellScript: EMBED_SCRIPT.split('\n').join('\\n'),
  });
  if (result && result.buildPhase) {
    result.buildPhase.alwaysOutOfDate = 1; // run on every build, no "ambiguous dependencies" warning
  }
}

function withMapboxNavigation(config, props = {}) {
  const token =
    props.accessToken || process.env.MAPBOX_ACCESS_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

  if (!token) {
    console.warn(
      '[mapbox-navigation] No access token found. Set the "accessToken" plugin option in app.json ' +
        'or the MAPBOX_ACCESS_TOKEN env variable (public token, starts with "pk.").'
    );
  } else if (!token.startsWith('pk.')) {
    console.warn('[mapbox-navigation] The access token should be a PUBLIC token (starts with "pk.").');
  }

  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    if (token) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, META_KEY, token);
    }

    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    const existing = new Set(manifest.manifest['uses-permission'].map((p) => p.$['android:name']));
    for (const name of REQUIRED_PERMISSIONS) {
      if (!existing.has(name)) {
        manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    return cfg;
  });

  // Add the Mapbox Maven repository to the root android/build.gradle (allprojects.repositories).
  config = withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      console.warn('[mapbox-navigation] android/build.gradle is not Groovy – add the Mapbox Maven repo manually.');
      return cfg;
    }
    if (!cfg.modResults.contents.includes(MAVEN_MARKER)) {
      cfg.modResults.contents = addMapboxRepo(cfg.modResults.contents);
    }
    return cfg;
  });

  // iOS: Mapbox reads the public token from Info.plist (MBXAccessToken)
  config = withInfoPlist(config, (cfg) => {
    if (token) cfg.modResults.MBXAccessToken = token;
    // "audio" lets spoken instructions keep playing when the app goes to the background.
    // Optional plugin prop `backgroundLocation: true` also adds "location" (navigation keeps running with the screen locked).
    const modes = new Set(Array.isArray(cfg.modResults.UIBackgroundModes) ? cfg.modResults.UIBackgroundModes : []);
    modes.add('audio');
    if (props.backgroundLocation) modes.add('location');
    cfg.modResults.UIBackgroundModes = Array.from(modes);
    if (!cfg.modResults.NSLocationWhenInUseUsageDescription) {
      cfg.modResults.NSLocationWhenInUseUsageDescription =
        'Your location is used to show you on the map and to guide you with turn-by-turn navigation.';
    }
    return cfg;
  });

  // iOS: React Native recommends dynamic frameworks for Swift Package Manager dependencies (Mapbox is SPM-only on iOS).
  config = withPodfileProperties(config, (cfg) => {
    if (!cfg.modResults['ios.useFrameworks']) cfg.modResults['ios.useFrameworks'] = 'dynamic';
    return cfg;
  });

  // iOS: embed Mapbox's dynamic frameworks in the app (otherwise it crashes at launch with dyld "Library not loaded")
  config = withXcodeProject(config, (cfg) => {
    addEmbedPhase(cfg.modResults);
    return cfg;
  });

  return config;
}

module.exports = withMapboxNavigation;
