# expo-mapbox-nav

Mapbox **map + turn-by-turn navigation** for **Expo** (Android + iOS), built with the Expo Modules API.

> **v2:** the Mapbox *Navigation SDK* is gone. The native side only draws the map (Mapbox **Maps** SDK); routing, banners,
> voice, rerouting, arrival and simulation run in **TypeScript** on top of the Mapbox **Directions API**. That means you are
> billed per route request, not per navigation user (the Navigation SDK bills monthly active users and trips).

- Turn-by-turn: same banner / voice / distance data Mapbox's `banner_instructions` & `voice_instructions` give, speed limits (`maxspeed`), traffic-coloured route line, off-route detection + rerouting, arrival events
- Streets map out of the box, **dark mode**, several map styles
- **Pressable markers** drawn from `react-native-svg` (rendered once, drawn on the GPU)
- `<Camera />` like `@rnmapbox/maps`, `react-native-maps`-style props
- 3D vehicle location puck (car / delivery motorbike)
- Navigation UI components that look **identical on iOS and Android**
- Route simulation for testing without driving
- The engine is plain TypeScript with unit tests (`npm test`), and you can plug your own route source (`routeProvider`)

> Requires a **development build** (not Expo Go). Expo SDK 58, React Native 0.88+. Maps SDK: Android 11.33.0, iOS 11.26.0.

### What differs from the official Navigation SDK (be aware)
- Position matching is simpler (nearest-segment snapping with heading), so GPS in tunnels / dense city canyons is less forgiving.
- No lane guidance, no road shields, no offline routing.
- Voice uses the device text-to-speech (`expo-speech`), not Mapbox's Polly voices; Arabic quality depends on the phone.
- Location comes from `expo-location` (foreground). The screen is kept awake while navigating. Background navigation is not included.
- Check [Mapbox's terms](https://www.mapbox.com/legal/tos) for using the Directions API outside their Navigation SDK.

## Install

```bash
npx expo install expo-mapbox-nav react-native-svg react-native-view-shot expo-location expo-speech expo-keep-awake
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
| iOS | writes `MBXAccessToken`, adds `UIBackgroundModes: audio` (spoken instructions keep playing in the background), sets `useFrameworks: dynamic`, and adds a build phase that embeds Mapbox's dynamic frameworks in the app |

If Gradle answers `401/403` when downloading the Maps SDK, create a secret token with the `DOWNLOADS:READ` scope and put it in `~/.gradle/gradle.properties`:

```
MAPBOX_DOWNLOADS_TOKEN=sk.xxxxx
```

(never commit it). The iOS build needs Xcode 16+ and Swift Package Manager access to GitHub (Maps SDK 11.26.0).

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

`styleURL`, `mapStyle`, `theme`, `units`, `origin`, `destination`, `waypoints`, `profile`, `language`, `alternatives`, `accessToken`, `routeProvider`, `simulate`, `simulationSpeed`, `muted`, `vehicle`, `vehicleScale` (1–100), `vehicleRotation`, `showsUserLocation`, `showDestinationPin`, `zoomEnabled`, `scrollEnabled`, `rotateEnabled`, `pitchEnabled`, `zoomControlEnabled` (no-op), `camera`.

### Events

`onReady`, `onLocation`, `onRouteReady`, `onRouteError`, `onNavigationStarted`, `onNavigationStopped`, `onProgress`, `onOffRoute`, `onArrival`, `onCameraModeChanged`, `onMapPress`, `onMapLongPress`, `onMarkerPress`, `onError`.

### Ref commands

`fetchRoute()`, `startNavigation()`, `stopNavigation()`, `recenter()`, `showOverview()`, `setCamera({...})`.

## Notes

- The bundled 3D vehicle models (`fs_car.glb`, `fs_bike.glb`) carry the FS logo. Replace the `.glb` files under `android/src/main/assets/models` and `ios/models` to brand your own.
- Mapbox usage (map loads, Directions requests) is billed according to Mapbox's pricing. This package is not affiliated with Mapbox.

## License

MIT (this wrapper). The Mapbox SDKs are under [Mapbox's terms](https://www.mapbox.com/legal/tos).

## Custom route source

```ts
import type { RouteProvider } from 'expo-mapbox-nav';
import { parseDirectionsRoute } from 'expo-mapbox-nav';

const provider: RouteProvider = {
  async getRoutes(coordinates, options) {
    const res = await fetch(`https://my-osrm.example.com/route/v1/driving/${coordinates.map((c) => c.join(',')).join(';')}?steps=true&geometries=polyline6&overview=full`);
    return (await res.json()).routes.map(parseDirectionsRoute);
  },
};
<MapboxNavigationView routeProvider={provider} … />
```
(OSRM answers use the same step/maneuver format; banners and voice texts only exist with the Mapbox API, so they must be generated by you.)

## Development

```bash
npm test      # engine + controller unit tests (no device needed)
npm run build # compile TypeScript to build/
```
