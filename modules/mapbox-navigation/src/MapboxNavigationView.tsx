import { requireNativeView } from 'expo';
import * as React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { isNativeModuleAvailable } from './MapboxNavigationModule';
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

export default function MapboxNavigationView({
  ref,
  style,
  children,
  camera: cameraProp,
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
  // ------------------------------------------------------------ camera
  const childArray = React.Children.toArray(children);
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
        ref={ref}
        style={[styles.fill, style]}
        {...rest}
        camera={camera}
        markers={markers}
        markerImages={images}
        onMarkerPress={(e: { nativeEvent: { id: string } }) => pressHandlers.current[e.nativeEvent.id]?.()}
        onReady={unwrap(onReady)}
        onLocation={unwrap(onLocation)}
        onRouteReady={unwrap(onRouteReady)}
        onRouteError={unwrap(onRouteError)}
        onNavigationStarted={unwrap(onNavigationStarted)}
        onNavigationStopped={unwrap(onNavigationStopped)}
        onProgress={unwrap(onProgress)}
        onOffRoute={unwrap(onOffRoute)}
        onArrival={unwrap(onArrival)}
        onCameraModeChanged={unwrap(onCameraModeChanged)}
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
