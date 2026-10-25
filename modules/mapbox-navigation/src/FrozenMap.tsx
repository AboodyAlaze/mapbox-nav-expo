import * as React from 'react';
import { Image, StyleSheet, View, useColorScheme, type StyleProp, type ViewStyle } from 'react-native';

import MapboxNavigationView from './MapboxNavigationView';
import type { MapboxNavigationViewProps, MapboxNavigationViewRef } from './MapboxNavigation.types';
import { setMapSnapshot, snapshotId } from './snapshots';
import { useMapSnapshot } from './useMapSnapshot';

export type FrozenMapProps = Omit<MapboxNavigationViewProps, 'style' | 'ref' | 'onMapLoaded'> & {
  /** Names the picture. Another view (`MapWithCover coverKey`) can use the same picture as its placeholder. */
  snapshotKey: string;
  style?: StyleProp<ViewStyle>;
  /**
   * Wait after the map says it is loaded, before the picture is taken (ms). The markers arrive a little after the
   * map, so do not make it too short. Default 900.
   */
  settleMs?: number;
  /** Called with the `file://` uri when the picture is taken. */
  onFrozen?: (uri: string) => void;
};

/**
 * A card with a map that is live ONLY ONCE: it loads, takes a picture of itself (the Maps SDK does it, so it is never
 * black) and turns into that picture. After that the card is a plain image: nothing on the GPU, nothing that can turn
 * black, and a screen transition can photograph it. No image files in your project.
 */
export function FrozenMap({ snapshotKey, style, settleMs = 900, onFrozen, children, ...mapProps }: FrozenMapProps) {
  const scheme = useColorScheme();
  const id = snapshotId(snapshotKey, mapProps.theme, scheme);
  const uri = useMapSnapshot(id);
  const mapRef = React.useRef<MapboxNavigationViewRef>(null);
  const [loaded, setLoaded] = React.useState(false);
  const size = React.useRef({ width: 0, height: 0 });
  const onFrozenRef = React.useRef(onFrozen);
  onFrozenRef.current = onFrozen;

  // another theme = another picture: load the map again
  React.useEffect(() => {
    setLoaded(false);
  }, [id]);

  React.useEffect(() => {
    if (uri || !loaded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const take = async () => {
      try {
        const taken = await mapRef.current?.takeSnapshot();
        if (taken && !cancelled) {
          setMapSnapshot(id, taken, size.current);
          onFrozenRef.current?.(taken);
        }
      } catch {
        // the map may not have drawn yet: try again a little later (3 times)
        if (!cancelled && ++attempts < 3) timer = setTimeout(take, 800);
      }
    };
    timer = setTimeout(take, settleMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [uri, loaded, id, settleMs]);

  return (
    <View
      style={[styles.root, style]}
      onLayout={(e) => {
        size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
      }}
    >
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" fadeDuration={0} style={StyleSheet.absoluteFill} />
      ) : (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <MapboxNavigationView
            showsUserLocation={false}
            zoomEnabled={false}
            scrollEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            {...mapProps}
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            onMapLoaded={() => setLoaded(true)}
          >
            {children}
          </MapboxNavigationView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: '#1c1c1e' },
});
