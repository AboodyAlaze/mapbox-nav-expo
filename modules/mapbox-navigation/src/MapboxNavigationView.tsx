import { requireNativeView } from 'expo';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import type { Fix } from './engine/engine';
import { getAccessToken, isNativeModuleAvailable } from './MapboxNavigationModule';
import { NavigationController, type NativeMap } from './NavigationController';
import type {
  CameraProps,
  MapboxNavigationViewProps,
  MapboxNavigationViewRef,
  MarkerProps,
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

/** Renders a marker's children off-screen, takes ONE PNG snapshot and reports it back. */
function IconCapture({ children, onDone }: { children: React.ReactNode; onDone: (b64: string | null) => void }) {
  const ref = React.useRef<React.ComponentRef<typeof View>>(null);
  const started = React.useRef(false);

  const capture = React.useCallback(async () => {
    if (started.current) return;
    started.current = true;
    await new Promise((r) => setTimeout(r, 80)); // let react-native-svg paint
    try {
      const b64 = await captureRef(ref, { format: 'png', result: 'base64', quality: 1 });
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
  // deprecated: Mapbox's native banner / speed sign no longer exist (use the JS NavigationUI components)
  showManeuverBanner: _showManeuverBanner,
  showSpeedLimit: _showSpeedLimit,
  topInset: _topInset,
  speedLimitBottomMargin: _speedLimitBottomMargin,
  zoomControlEnabled: _zoomControlEnabled, // no-op (Mapbox has no zoom buttons)
  onReady,
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
  React.useEffect(() => {
    if (NativeView) fireReady();
  }, [fireReady]);

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

  React.useImperativeHandle(
    ref,
    () => ({
      fetchRoute: () => controller.fetchRoute(),
      startNavigation: () => controller.startNavigation(),
      stopNavigation: async () => controller.stopNavigation(),
      recenter: async () => controller.recenter(),
      showOverview: async () => controller.showOverview(),
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
    return {
      id,
      latitude: p.coordinate.latitude,
      longitude: p.coordinate.longitude,
      icon: p.iconKey ?? `m:${id}`,
      anchorX: p.anchor?.x ?? 0.5,
      anchorY: p.anchor?.y ?? 1,
    };
  });
  const markersJson = JSON.stringify(markerData);
  const markers = React.useMemo(() => JSON.parse(markersJson), [markersJson]);

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

  const pending = [...iconSources.keys()].filter((k) => !(k in finished)).slice(0, MAX_PARALLEL_CAPTURES);

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

  return (
    <>
      <NativeView
        ref={nativeRef}
        style={[styles.fill, style]}
        {...rest}
        destination={destination}
        camera={camera}
        markers={markers}
        markerImages={images}
        onMarkerPress={(e: { nativeEvent: { id: string } }) => pressHandlers.current[e.nativeEvent.id]?.()}
        onReady={fireReady}
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
