import { requireNativeView } from 'expo';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as React from 'react';
import { NavigationContext } from '@react-navigation/native';
import * as ReactNative from 'react-native';
import { Image, Platform, StyleSheet, Text, useColorScheme, View } from 'react-native';

// InteractionManager is deprecated / missing in recent React Native versions: never assume it exists.
const getInteractionManager = (): { runAfterInteractions?: (task: () => void) => { cancel?: () => void } } | undefined =>
  (ReactNative as any).InteractionManager;

import type { Fix } from './engine/engine';
import { getAccessToken, isNativeModuleAvailable } from './MapboxNavigationModule';
import { NavigationController, type NativeMap } from './NavigationController';
import type {
  CameraProps,
  MapboxNavigationViewProps,
  MapboxNavigationViewRef,
  MarkerProps,
  MarkerSize,
} from './MapboxNavigation.types';

const NativeView: React.ComponentType<any> | null =
  (Platform.OS === 'android' || Platform.OS === 'ios') && isNativeModuleAvailable ? requireNativeView('MapboxNavigation') : null;

type Props = MapboxNavigationViewProps & {
  ref?: React.Ref<MapboxNavigationViewRef>;
};

// Native events arrive as { nativeEvent: payload }. Unwrap them so callbacks receive the payload directly.
const unwrap =
  <T,>(cb?: (payload: T) => void) =>
  (event: { nativeEvent: T }) =>
    cb?.(event.nativeEvent);

type MarkerElement = React.ReactElement<MarkerProps>;
const isMarker = (child: React.ReactNode): child is MarkerElement =>
  React.isValidElement(child) && (child.type as any)?.__mapboxMarker === true;

// Android draws marker icons natively (`svg` / `image` props). The old path (render the children off-screen with
// react-native-svg, screenshot them, send base64) is kept for iOS only: it is what made the Android map slow.
const LEGACY_CAPTURE = Platform.OS !== 'android';
const captureRef: ((ref: any, options: any) => Promise<string>) | null = LEGACY_CAPTURE
  ? require('react-native-view-shot').captureRef
  : null;

type NativeIcon = { key: string; svg?: string; uri?: string; width: number; height: number };

const hashCache = new Map<string, string>();
function hashString(value: string): string {
  const cached = hashCache.get(value);
  if (cached) return cached;
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  const out = `${(h >>> 0).toString(36)}${value.length.toString(36)}`;
  if (hashCache.size > 200) hashCache.clear();
  hashCache.set(value, out);
  return out;
}

const normalizeSize = (size?: MarkerSize) =>
  size === undefined ? undefined : typeof size === 'number' ? { width: size, height: size } : size;

/** What the native side needs to draw this marker's picture (one entry per distinct picture). */
function nativeIconFor(p: MarkerProps): NativeIcon | null {
  const size = normalizeSize(p.size);
  const w = size?.width ?? 0;
  const h = size?.height ?? 0;
  if (p.svg) {
    return { key: p.iconKey ?? `svg:${hashString(p.svg)}:${w}x${h}`, svg: p.svg, width: w, height: h };
  }
  if (p.image) {
    const source = Image.resolveAssetSource(p.image);
    if (!source?.uri) return null;
    const width = w || source.width || 0;
    const height = h || source.height || 0;
    return { key: p.iconKey ?? `img:${source.uri}:${width}x${height}`, uri: source.uri, width, height };
  }
  return null;
}

/** true while the screen that hosts the map is the focused one (always true outside a navigator). */
function useScreenFocused(enabled: boolean): boolean {
  const navigation = React.useContext(NavigationContext);
  const [focused, setFocused] = React.useState(() => (navigation ? navigation.isFocused() : true));
  React.useEffect(() => {
    if (!enabled || !navigation) return;
    setFocused(navigation.isFocused());
    const onFocus = navigation.addListener('focus', () => setFocused(true));
    const onBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      onFocus();
      onBlur();
    };
  }, [navigation, enabled]);
  return enabled ? focused : true;
}

/** Renders a marker's children off-screen, takes ONE PNG snapshot and reports it back (iOS only). */
function IconCapture({ children, onDone }: { children: React.ReactNode; onDone: (b64: string | null) => void }) {
  const ref = React.useRef<React.ComponentRef<typeof View>>(null);
  const started = React.useRef(false);

  const capture = React.useCallback(async () => {
    if (started.current) return;
    started.current = true;
    await new Promise((r) => setTimeout(r, 80)); // let react-native-svg paint
    try {
      const b64 = await captureRef!(ref, { format: 'png', result: 'base64', quality: 1 });
      onDone(b64);
    } catch {
      onDone(null);
    }
  }, [onDone]);

  return (
    <View
      ref={ref}
      collapsable={false}
      pointerEvents="none"
      onLayout={capture}
      style={{ position: 'absolute', left: -5000, top: 0, alignItems: 'flex-start' }}>
      {children}
    </View>
  );
}

const isCamera = (child: React.ReactNode): child is React.ReactElement<CameraProps> =>
  React.isValidElement(child) && (child.type as any)?.__mapboxCamera === true;

const MAX_PARALLEL_CAPTURES = 4;

const KEEP_AWAKE_TAG = 'expo-mapbox-nav';

/** Fire-and-forget call of a native async function (errors must never crash the JS thread). */
const fire = (p: unknown) => {
  if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
};

function toFix(loc: Location.LocationObject): Fix {
  const c = loc.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    heading: c.heading !== null && c.heading !== undefined && c.heading >= 0 ? c.heading : undefined,
    speed: c.speed !== null && c.speed !== undefined && c.speed >= 0 ? c.speed : 0,
    accuracy: c.accuracy ?? undefined,
    timestamp: loc.timestamp,
  };
}

export default function MapboxNavigationView({
  ref,
  style,
  children,
  camera: cameraProp,
  // navigation props (handled in JS by the NavigationController)
  origin,
  destination,
  waypoints,
  profile,
  language,
  units,
  simulate,
  simulationSpeed,
  muted,
  alternatives,
  routeProvider,
  accessToken,
  pauseWhenBlurred = true,
  paused: pausedProp = false,
  deferMount = true,
  placeholderColor,
  // deprecated: Mapbox's native banner / speed sign no longer exist (use the JS NavigationUI components)
  showManeuverBanner: _showManeuverBanner,
  showSpeedLimit: _showSpeedLimit,
  topInset: _topInset,
  speedLimitBottomMargin: _speedLimitBottomMargin,
  zoomControlEnabled: _zoomControlEnabled, // no-op (Mapbox has no zoom buttons)
  onReady,
  onMapLoaded,
  onLocation,
  onRouteReady,
  onRouteError,
  onNavigationStarted,
  onNavigationStopped,
  onProgress,
  onOffRoute,
  onArrival,
  onCameraModeChanged,
  onError,
  onMapPress,
  onMapLongPress,
  ...rest
}: Props) {
  const nativeRef = React.useRef<any>(null);

  // `ready` is reported from JS: native events sent while the view is being created would be lost
  // (the JS listener is not attached yet), which left buttons disabled.
  const onReadyRef = React.useRef(onReady);
  onReadyRef.current = onReady;
  const readyFired = React.useRef(false);
  const fireReady = React.useCallback(() => {
    if (readyFired.current) return;
    readyFired.current = true;
    onReadyRef.current?.({ ready: true });
  }, []);

  // ------------------------------------------------------------ deferred mount + pause while the screen is not focused
  const [mounted, setMounted] = React.useState(!deferMount);
  React.useEffect(() => {
    if (mounted) return;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setMounted(true);
    };
    let handle: { cancel?: () => void } | undefined;
    try {
      handle = getInteractionManager()?.runAfterInteractions?.(go);
    } catch {
      handle = undefined;
    }
    // never wait forever for a long-running interaction; without InteractionManager wait about one transition
    const timer = setTimeout(go, handle ? 900 : 350);
    return () => {
      done = true;
      handle?.cancel?.();
      clearTimeout(timer);
    };
  }, [mounted]);

  const focused = useScreenFocused(pauseWhenBlurred);
  const paused = pausedProp || !focused;
  const scheme = useColorScheme();
  const dark = rest.theme === 'dark' || (rest.theme !== 'light' && scheme === 'dark');

  React.useEffect(() => {
    if (NativeView && mounted) fireReady();
  }, [fireReady, mounted]);

  // ------------------------------------------------------------ navigation controller (pure TypeScript)
  const accessTokenRef = React.useRef(accessToken);
  accessTokenRef.current = accessToken;

  const controller = React.useMemo(() => {
    const native: NativeMap = {
      updateLocation: (lat, lng, bearing, acc, ms) => fire(nativeRef.current?.updateLocation(lat, lng, bearing, acc, ms)),
      followCamera: (lat, lng, bearing, zoom, pitch, ms) => fire(nativeRef.current?.followCamera(lat, lng, bearing, zoom, pitch, ms)),
      fitCamera: (coords, t, r, b, l, ms) => fire(nativeRef.current?.fitCamera(coords, t, r, b, l, ms)),
      setRoute: (geojson, gradient) => fire(nativeRef.current?.setRoute(geojson, gradient)),
      setAlternatives: (geojson) => fire(nativeRef.current?.setAlternatives(geojson)),
      setRouteProgress: (f) => fire(nativeRef.current?.setRouteProgress(f)),
      clearRoute: () => fire(nativeRef.current?.clearRoute()),
    };
    return new NavigationController({
      native: () => (nativeRef.current ? native : null),
      getToken: () => accessTokenRef.current || getAccessToken(),
      watchLocation: (cb, mode) => {
        let removed = false;
        let sub: Location.LocationSubscription | null = null;
        const options: Location.LocationOptions =
          mode === 'navigation'
            ? { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 }
            : { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 3 };
        Location.watchPositionAsync(options, (loc) => cb(toFix(loc)))
          .then((s) => {
            if (removed) s.remove();
            else sub = s;
          })
          .catch(() => {});
        return {
          remove() {
            removed = true;
            sub?.remove();
          },
        };
      },
      speak: (text, lang) => {
        try {
          Speech.stop();
          Speech.speak(text, { language: lang });
        } catch {}
      },
      stopSpeaking: () => {
        try {
          Speech.stop();
        } catch {}
      },
      keepAwake: (on) => {
        if (on) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
        else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      },
      provider: routeProvider,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const childArray = React.Children.toArray(children);

  // real size of the 3D model on the map (meters × scale): the route line starts in front of it
  const vehicleScale = rest.vehicleScale ?? 8;
  const puckHalfLength = rest.vehicle === 'none' ? 0 : (rest.vehicle === 'bike' ? 1.1 : 2.3) * vehicleScale;

  // keep props / events in sync (cheap: no native calls here)
  controller.setProps({ origin, destination, waypoints, profile, language, units, simulate, simulationSpeed, muted, alternatives, pitchEnabled: rest.pitchEnabled, puckHalfLength, autoCenter: !(cameraProp || childArray.some(isCamera)) });
  controller.setEvents({
    onLocation,
    onRouteReady,
    onRouteError,
    onNavigationStarted,
    onNavigationStopped,
    onProgress,
    onOffRoute,
    onArrival,
    onCameraModeChanged,
    onError,
  });

  React.useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  // GPS only while the puck is wanted (a static card with showsUserLocation={false} never starts a watch)
  const wantsLocation = rest.showsUserLocation !== false;
  React.useEffect(() => {
    controller.setLocate(wantsLocation);
  }, [controller, wantsLocation]);

  React.useImperativeHandle(
    ref,
    () => ({
      fetchRoute: () => controller.fetchRoute(),
      startNavigation: () => controller.startNavigation(),
      stopNavigation: async () => controller.stopNavigation(),
      recenter: async () => controller.recenter(),
      showOverview: async () => controller.showOverview(),
      takeSnapshot: async () => {
        const uri = await nativeRef.current?.takeSnapshot();
        if (!uri) throw new Error('The map is not ready yet');
        return uri as string;
      },
      setCamera: async (c: CameraProps) => {
        await nativeRef.current?.setCamera(c);
      },
    }),
    [controller]
  );

  // ------------------------------------------------------------ camera
  const cameraChild = childArray.find(isCamera);
  const cameraValue: CameraProps | undefined = cameraChild ? cameraChild.props : cameraProp;
  const cameraJson = cameraValue ? JSON.stringify(cameraValue) : undefined;
  const camera = React.useMemo(() => (cameraJson ? JSON.parse(cameraJson) : undefined), [cameraJson]);

  // ------------------------------------------------------------ markers
  const markerElements = childArray.filter(isMarker);

  const markerData = markerElements.map((el, index) => {
    const p = el.props;
    const id = p.id ?? (el.key != null ? String(el.key) : `marker-${index}`);
    const nativeIcon = nativeIconFor(p);
    return {
      id,
      latitude: p.coordinate.latitude,
      longitude: p.coordinate.longitude,
      icon: LEGACY_CAPTURE ? (p.iconKey ?? `m:${id}`) : (nativeIcon?.key ?? `m:${id}`),
      anchorX: p.anchor?.x ?? 0.5,
      anchorY: p.anchor?.y ?? 1,
    };
  });
  const markersJson = JSON.stringify(markerData);
  const markers = React.useMemo(() => JSON.parse(markersJson), [markersJson]);

  // distinct pictures, drawn natively (Android)
  const iconsJson = LEGACY_CAPTURE
    ? '[]'
    : JSON.stringify(
        [...new Map(markerElements.map((el) => nativeIconFor(el.props)).filter((i): i is NativeIcon => !!i).map((i) => [i.key, i])).values()]
      );
  const markerIcons = React.useMemo(() => JSON.parse(iconsJson), [iconsJson]);
  if (__DEV__ && !LEGACY_CAPTURE) {
    markerElements.forEach((el) => {
      if (!el.props.svg && !el.props.image && el.props.children) {
        console.warn('[expo-mapbox-nav] <Marker> children are not drawn on Android any more: pass `svg` (or `image`) instead.');
      }
    });
  }

  const pressHandlers = React.useRef<Record<string, (() => void) | undefined>>({});
  pressHandlers.current = Object.fromEntries(markerElements.map((el, i) => [markerData[i].id, el.props.onPress]));

  // first <Marker> children per icon key
  const iconSources = new Map<string, React.ReactNode>();
  markerElements.forEach((el, i) => {
    const key = markerData[i].icon;
    if (!iconSources.has(key)) iconSources.set(key, el.props.children);
  });

  const [images, setImages] = React.useState<Record<string, string>>({});
  const [finished, setFinished] = React.useState<Record<string, true>>({});

  const pending = LEGACY_CAPTURE ? [...iconSources.keys()].filter((k) => !(k in finished)).slice(0, MAX_PARALLEL_CAPTURES) : [];

  const onCaptured = React.useCallback((key: string, b64: string | null) => {
    if (b64) setImages((prev) => ({ ...prev, [key]: b64 }));
    setFinished((prev) => ({ ...prev, [key]: true }));
  }, []);

  if (!NativeView) {
    return (
      <View style={[styles.fallback, style]}>
        <Text style={styles.fallbackText}>
          Mapbox Navigation needs a development build (iOS / Android) – it does not run in Expo Go.
        </Text>
      </View>
    );
  }

  if (!mounted) {
    return <View style={[styles.fill, style, { backgroundColor: placeholderColor ?? (dark ? '#1C1C1E' : '#EDEBE6') }]} />;
  }

  return (
    <>
      <NativeView
        ref={nativeRef}
        style={[styles.fill, style]}
        {...rest}
        destination={destination}
        camera={camera}
        {...(Platform.OS === 'android' ? { paused } : {})}
        markers={markers}
        {...(LEGACY_CAPTURE ? { markerImages: images } : { markerIcons })}
        onMarkerPress={(e: { nativeEvent: { id: string } }) => pressHandlers.current[e.nativeEvent.id]?.()}
        onReady={fireReady}
        onMapLoaded={unwrap(onMapLoaded)}
        onCameraModeChanged={(e: { nativeEvent: { mode: 'following' | 'overview' | 'idle' } }) =>
          controller.onNativeCameraMode(e.nativeEvent.mode)
        }
        onError={unwrap(onError)}
        onMapPress={unwrap(onMapPress)}
        onMapLongPress={unwrap(onMapLongPress)}
      />
      {pending.map((key) => (
        <IconCapture key={key} onDone={(b64) => onCaptured(key, b64)}>
          {iconSources.get(key)}
        </IconCapture>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#eee' },
  fallbackText: { textAlign: 'center', color: '#333' },
});
