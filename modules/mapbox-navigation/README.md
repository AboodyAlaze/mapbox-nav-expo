# expo-mapbox-nav

[Mapbox Navigation SDK v3](https://docs.mapbox.com/ios/navigation/) for **Expo** (Android + iOS), built with the Expo Modules API.

- Turn-by-turn navigation with voice guidance, rerouting and arrival events
- Streets map out of the box, **dark mode**, and several map styles
- **Pressable markers** drawn from `react-native-svg` (rendered once, drawn on the GPU)
- `<Camera />` like `@rnmapbox/maps` (`zoomLevel`, `centerCoordinate`, `animationMode`, …)
- `react-native-maps`-style props (`showsUserLocation`, `zoomEnabled`, `scrollEnabled`, `rotateEnabled`, `pitchEnabled`)
- 3D vehicle location puck (car / delivery motorbike)
- Ready-made navigation UI (banner, MAX speed sign, road pill, bottom bar) that looks **identical on iOS and Android**
- Route simulation for testing without driving

> Requires a **development build** (it does not run in Expo Go). Expo SDK 58, React Native 0.88+.
> iOS is pinned to Navigation SDK **3.26.0** (the newest release whose Maps / NavigationNative dependencies are published); Android uses **3.33.0**.

## Install

```bash
npx expo install expo-mapbox-nav react-native-svg react-native-view-shot expo-location
```

Add the config plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [
      ["expo-location", { "locationWhenInUsePermission": "Your location is used for navigation." }],
      ["expo-mapbox-nav", { "accessToken": "", "backgroundLocation": false }]
    ]
  }
}
```

Provide your **public** Mapbox token (`pk.…`). Prefer an environment variable so it never lands in git:

```bash
MAPBOX_ACCESS_TOKEN=pk.xxxxx npx expo prebuild --clean
npx expo run:ios      # or run:android
```

What the plugin does for you:

| Platform | |
| --- | --- |
| Android | writes the token to `AndroidManifest.xml`, adds the Mapbox Maven repository and the location / foreground-service permissions |
| iOS | writes `MBXAccessToken`, adds `UIBackgroundModes: audio` (required by Mapbox for spoken instructions), sets `useFrameworks: dynamic`, and adds a build phase that embeds Mapbox's dynamic frameworks in the app |

If Gradle answers `401/403` when downloading the SDK, create a secret token with the `DOWNLOADS:READ` scope and put it in `~/.gradle/gradle.properties`:

```
MAPBOX_DOWNLOADS_TOKEN=sk.xxxxx
```

(never commit it). The iOS build needs Xcode 16+ and Swift Package Manager access to GitHub.

## Usage

```tsx
import Svg, { Path } from 'react-native-svg';
import {
  MapboxNavigationView, Marker, Camera,
  NavigationTopBanner, NavigationBottomBar, SpeedLimitSign,
  type MapboxNavigationViewRef, type ProgressEvent,
} from 'expo-mapbox-nav';

const ref = useRef<MapboxNavigationViewRef>(null);
const [progress, setProgress] = useState<ProgressEvent | null>(null);

<MapboxNavigationView
  ref={ref}
  style={{ flex: 1 }}
  destination={{ latitude: 33.2625, longitude: 44.2346 }}
  mapStyle="streets"            // streets | navigation | outdoors | satellite
  theme="system"                // system | light | dark
  vehicle="car"                 // car | bike | none
  onProgress={setProgress}
  onArrival={(e) => e.final && console.log('arrived')}
>
  <Camera zoomLevel={13} centerCoordinate={[44.4, 33.3]} animationMode="flyTo" animationDuration={1000} />

  <Marker id="shop-1" coordinate={{ latitude: 33.3, longitude: 44.4 }} iconKey="shop" onPress={() => open('shop-1')}>
    <Svg width={34} height={44}>{/* … */}</Svg>
  </Marker>
</MapboxNavigationView>

ref.current?.startNavigation();   // requests the route and starts guidance
ref.current?.stopNavigation();
```

`<NavigationTopBanner />`, `<NavigationBottomBar />`, `<SpeedLimitSign />`, `<RoadNamePill />` and `<ManeuverIcon />` are plain React Native components you can feed with the `onProgress` payload.

### Markers and performance

Every `<Marker>` child (an SVG) is rasterised **once per `iconKey`** and drawn inside the map (one GPU layer, no native view per marker). Give identical markers the same `iconKey`. Updates are diffed: only added / moved / removed markers are touched.

### View props

`styleURL`, `mapStyle`, `theme`, `units`, `origin`, `destination`, `waypoints`, `profile`, `language`, `simulate`, `simulationSpeed` (Android), `muted`, `vehicle`, `vehicleScale` (1–100), `vehicleRotation`, `showsUserLocation`, `showDestinationPin`, `zoomEnabled`, `scrollEnabled`, `rotateEnabled`, `pitchEnabled`, `zoomControlEnabled` (no-op), `camera`.

### Events

`onReady`, `onLocation`, `onRouteReady`, `onRouteError`, `onNavigationStarted`, `onNavigationStopped`, `onProgress`, `onOffRoute`, `onArrival`, `onCameraModeChanged`, `onMapPress`, `onMapLongPress`, `onMarkerPress`, `onError`.

### Ref commands

`fetchRoute()`, `startNavigation()`, `stopNavigation()`, `recenter()`, `showOverview()`, `setCamera({...})`.

## Notes

- The bundled 3D vehicle models (`fs_car.glb`, `fs_bike.glb`) carry the FS logo. Replace the `.glb` files under `android/src/main/assets/models` and `ios/models` to brand your own.
- Mapbox usage is billed according to Mapbox's pricing. This package is not affiliated with Mapbox.

## License

MIT (this wrapper). The Mapbox SDKs are under [Mapbox's terms](https://www.mapbox.com/legal/tos).
