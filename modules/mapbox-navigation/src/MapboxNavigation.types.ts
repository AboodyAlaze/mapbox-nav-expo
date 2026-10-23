import type { ReactNode } from 'react';
import type { RouteProvider } from './engine/directions';
import type { StyleProp, ViewStyle } from 'react-native';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type CameraAnimationMode = 'flyTo' | 'easeTo' | 'linearTo' | 'moveTo' | 'none';

/** Same shape as the @rnmapbox/maps <Camera/> props. */
export type CameraProps = {
  /** [longitude, latitude] */
  centerCoordinate?: [number, number];
  zoomLevel?: number;
  /** Tilt in degrees (0 = top-down). */
  pitch?: number;
  /** Map rotation in degrees (0 = north up). */
  heading?: number;
  /** Default 'moveTo' (instant). */
  animationMode?: CameraAnimationMode;
  /** Milliseconds. Default 1000. */
  animationDuration?: number;
  minZoomLevel?: number;
  maxZoomLevel?: number;
};

export type MarkerProps = {
  /** Stable id (defaults to the React key). */
  id?: string;
  coordinate: Coordinate;
  /** Anchor of the icon, like react-native-maps. Default { x: 0.5, y: 1 } (bottom-center). */
  anchor?: { x: number; y: number };
  /**
   * Markers sharing the same `iconKey` share ONE rasterised image (rendered once).
   * Use it for lists of identical markers – it is what keeps hundreds of markers fast.
   * Defaults to a per-marker key.
   */
  iconKey?: string;
  onPress?: () => void;
  /** The marker's look – typically a react-native-svg <Svg/>. Rendered once and drawn natively on the map. */
  children?: ReactNode;
};

export type MapStyleName = 'navigation' | 'streets' | 'outdoors' | 'satellite';
export type ThemeMode = 'system' | 'light' | 'dark';
export type Units = 'metric' | 'imperial';

export type VehicleType = 'car' | 'bike' | 'none';

export type MapPressEvent = {
  latitude: number;
  longitude: number;
  /** True when a place / POI was tapped (name & category may be present). */
  isPlace?: boolean;
  name?: string;
  category?: string;
};

export type TravelProfile = 'driving-traffic' | 'driving' | 'walking' | 'cycling';

export type CameraMode = 'following' | 'overview' | 'idle';

// ------------------------------------------------------------------ event payloads
export type LocationEvent = {
  latitude: number;
  longitude: number;
  speed: number; // m/s
  bearing?: number; // degrees
};

export type RouteReadyEvent = {
  distance: number; // meters
  duration: number; // seconds
  routeCount: number; // primary + alternatives
};

export type ErrorEvent = {
  code: string;
  message: string;
};

export type NavigationStartedEvent = { simulated: boolean };
export type NavigationStoppedEvent = { reason: string };

export type ProgressEvent = {
  distanceRemaining: number; // meters (whole route)
  durationRemaining: number; // seconds (whole route)
  fractionTraveled: number; // 0..1
  stepDistanceRemaining: number; // meters to the next maneuver
  instruction?: string; // primary banner text, e.g. "Turn right onto Main St"
  secondaryInstruction?: string;
  maneuverType?: string; // "turn", "merge", "roundabout", "arrive" ...
  maneuverModifier?: string; // "left", "right", "straight" ...
  roadName?: string; // current road
  speedLimit?: number; // posted limit, in `speedUnit`
  speedUnit?: 'km/h' | 'mph';
  currentSpeed?: number; // in `speedUnit`
};

export type OffRouteEvent = { offRoute: boolean };
export type ArrivalEvent = { final: boolean };
export type CameraModeEvent = { mode: CameraMode };
export type ReadyEvent = { ready: boolean };

// ------------------------------------------------------------------ view props / ref
export type MapboxNavigationViewProps = {
  style?: StyleProp<ViewStyle>;
  /** <Marker/> and <Camera/> elements. */
  children?: ReactNode;
  /** Same as a <Camera/> child, as a prop. */
  camera?: CameraProps;

  // ---- react-native-maps compatible props
  /** Show a built-in pin on `destination` while no route is displayed. Default true. */
  showDestinationPin?: boolean;
  /** Show the user's location marker (the FS vehicle). Default true. */
  showsUserLocation?: boolean;
  /** Pinch / double-tap zoom. Default true. */
  zoomEnabled?: boolean;
  /** Accepted for react-native-maps compatibility. Mapbox has no on-screen zoom buttons, so it is a no-op. */
  zoomControlEnabled?: boolean;
  /** Pan the map with one finger. Default true. */
  scrollEnabled?: boolean;
  /** Rotate the map with two fingers. Default true. */
  rotateEnabled?: boolean;
  /** Tilt the map. Default true. */
  pitchEnabled?: boolean;


  /** Full Mapbox style URL. Overrides `mapStyle` + `theme` when set. */
  styleURL?: string;
  /** Built-in map look. Default: 'navigation'. 'streets' switches to Mapbox Dark in dark mode. */
  mapStyle?: MapStyleName;
  /** 3D FS vehicle shown as your location marker: 'car' (default), 'bike' (delivery motorbike) or 'none' (plain arrow). */
  vehicle?: VehicleType;
  /** Size multiplier of the 3D vehicle (real-world meters × scale). 1–100, default 8. */
  vehicleScale?: number;
  /** Extra rotation of the 3D vehicle in degrees (use 180 if it appears to drive backwards). */
  vehicleRotation?: number;
  /** 'system' follows the phone's dark mode (default), or force 'light' / 'dark'. */
  theme?: ThemeMode;
  /** Distance units for banner / speed sign / voice. Default: from device locale. */
  units?: Units;
  /** @deprecated No native banner anymore – use the NavigationUI components (NavigationTopBanner…). Ignored. */
  showManeuverBanner?: boolean;
  /** @deprecated Use <SpeedLimitSign/>. Ignored. */
  showSpeedLimit?: boolean;
  /** @deprecated Ignored. */
  topInset?: number;
  /** @deprecated Ignored. */
  speedLimitBottomMargin?: number;
  /** Public Mapbox token for route requests. Defaults to the token set through the config plugin. */
  accessToken?: string;
  /** Request alternative routes (drawn in grey). Default true. */
  alternatives?: boolean;
  /** Custom route source (your own OSRM / Valhalla server…). Default: Mapbox Directions API. */
  routeProvider?: RouteProvider;
  /** Start point. When omitted the current GPS location is used. */
  origin?: Coordinate;
  /** Final destination. */
  destination?: Coordinate;
  /** Optional intermediate stops. */
  waypoints?: Coordinate[];
  /** Routing profile. Default: 'driving-traffic'. */
  profile?: TravelProfile;
  /** Language of instructions/voice, e.g. 'en', 'ar'. Default: device language. */
  language?: string;
  /** Simulate driving along the route (no need to move – great for testing). */
  simulate?: boolean;
  /** Playback speed of the simulation (0.5 – 8). Default 1. */
  simulationSpeed?: number;
  /** Mute voice guidance. */
  muted?: boolean;

  onReady?: (event: ReadyEvent) => void;
  onLocation?: (event: LocationEvent) => void;
  onRouteReady?: (event: RouteReadyEvent) => void;
  onRouteError?: (event: ErrorEvent) => void;
  onNavigationStarted?: (event: NavigationStartedEvent) => void;
  onNavigationStopped?: (event: NavigationStoppedEvent) => void;
  onProgress?: (event: ProgressEvent) => void;
  onOffRoute?: (event: OffRouteEvent) => void;
  onArrival?: (event: ArrivalEvent) => void;
  onCameraModeChanged?: (event: CameraModeEvent) => void;
  onError?: (event: ErrorEvent) => void;
  onMapPress?: (event: MapPressEvent) => void;
  onMapLongPress?: (event: MapPressEvent) => void;
};

export type MapboxNavigationViewRef = {
  /** Moves the camera imperatively (zoom, center, pitch, heading, with animation). */
  setCamera: (camera: CameraProps) => Promise<void>;
  /** Requests a route for the current props and previews it on the map. */
  fetchRoute: () => Promise<void>;
  /** Starts turn-by-turn navigation (requests a route first if needed). */
  startNavigation: () => Promise<void>;
  /** Stops navigation and clears the route. */
  stopNavigation: () => Promise<void>;
  /** Moves the camera back to the user (following mode). */
  recenter: () => Promise<void>;
  /** Shows the whole route. */
  showOverview: () => Promise<void>;
};
