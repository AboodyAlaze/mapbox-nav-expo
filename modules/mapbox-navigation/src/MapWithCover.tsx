import * as React from 'react';
import {
  Animated,
  StyleSheet,
  View,
  useColorScheme,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import MapboxNavigationView from './MapboxNavigationView';
import type { CameraProps, MapboxNavigationViewProps, MapboxNavigationViewRef } from './MapboxNavigation.types';
import { coverFitsLayout, setMapSnapshot, snapshotId, zoomToFillScreen } from './snapshots';
import { useMapSnapshotInfo } from './useMapSnapshot';

export type MapWithCoverRef = {
  /**
   * Shows the picture again, at once, and keeps it. Call it right before the screen is photographed (a screen
   * transition, a screenshot…): a live map is a GPU surface and comes out black in a photo.
   */
  showCover: () => void;
  /**
   * Better than `showCover` when the user may have moved the map: takes a picture of the map AS IT IS NOW (made by the
   * Maps SDK, so it is exact: same area, same size of labels and pins), shows it as the cover and resolves when it is
   * drawn. The screen can then be photographed (a "back" transition): what is photographed is what the user sees.
   */
  captureCover: () => Promise<void>;
  /** The map's own methods (see `MapboxNavigationViewRef`). */
  takeSnapshot: () => Promise<string>;
  fetchRoute: () => Promise<void>;
  startNavigation: () => Promise<void>;
  stopNavigation: () => Promise<void>;
  showOverview: () => Promise<void>;
  recenter: () => Promise<void>;
};

export type MapWithCoverProps = Omit<MapboxNavigationViewProps, 'onMapLoaded' | 'style'> & {
  /** The picture shown until the live map is loaded. Either give it here, or use `coverKey`. */
  cover?: ImageSourcePropType;
  /**
   * The `snapshotKey` of a `FrozenMap`: its picture (taken by the map itself, for the current theme) is the cover, so
   * the two screens show exactly the same picture. No image files needed. Without any picture the live map is built
   * at once.
   */
  coverKey?: string;
  /**
   * Build the live map now? Pass `false` while something heavy or photographed is going on (a screen transition) and
   * `true` afterwards. Default `true`.
   */
  mount?: boolean;
  /**
   * The view of the world that the picture (the card) shows: centre and zoom of the card's map. The live map starts
   * EXACTLY there (scaled for the bigger screen, see `zoomToFillScreen`) so the picture and the map are the same view
   * and nothing jumps when the map fades in. Without it the live map would start at the SDK's default (New York).
   */
  coverCamera?: { centerCoordinate: [number, number]; zoomLevel: number };
  /** The picture is loaded and drawn (use it to tell a screen transition that this screen is ready). */
  onCoverLoaded?: () => void;
  /** Longest wait for the live map before it replaces the picture anyway, in ms. Default 2500. */
  timeoutMs?: number;
  /** Length of the fade from the picture to the live map, in ms. Default 260. */
  fadeMs?: number;
  /**
   * Once the live map is shown (and the user has not touched it) a picture of it, SCREEN-sized, is kept as the better
   * cover for the next time (the picture of a small card, stretched over a whole screen, has labels and pins that are
   * too big and blurry). Wait this long (ms) after the fade so the markers are drawn. Default 1200. 0 = never.
   */
  screenCoverDelayMs?: number;
  style?: StyleProp<ViewStyle>;
  ref?: React.Ref<MapWithCoverRef>;
};

/**
 * A map that is ALWAYS shown at once: a picture first, then the live map fades in over it as soon as it is loaded.
 * Nothing is ever black or blank, and the (slow) creation of the live map can be postponed with `mount`.
 */
export function MapWithCover({
  cover: coverProp,
  coverKey,
  coverCamera,
  mount = true,
  onCoverLoaded,
  timeoutMs = 2500,
  fadeMs = 260,
  screenCoverDelayMs = 1200,
  style,
  children,
  ref,
  ...mapProps
}: MapWithCoverProps) {
  const scheme = useColorScheme();
  const mapRef = React.useRef<MapboxNavigationViewRef>(null);
  const cardId = coverKey ? snapshotId(coverKey, mapProps.theme, scheme) : undefined;
  const screenId = coverKey ? snapshotId(`${coverKey}@screen`, mapProps.theme, scheme) : undefined;
  const info = useMapSnapshotInfo(cardId); // the picture of the card: also tells the size of the card (for the zoom)
  const screenInfo = useMapSnapshotInfo(screenId);
  const [layout, setLayout] = React.useState({ width: 0, height: 0 });
  const [fresh, setFresh] = React.useState<string | undefined>();
  const screenUri = screenInfo && coverFitsLayout(screenInfo, layout) ? screenInfo.uri : undefined;
  const coverUri = fresh ?? screenUri ?? (coverProp ? undefined : info?.uri);
  const cover = React.useMemo<ImageSourcePropType | undefined>(
    () => (coverUri ? { uri: coverUri } : coverProp),
    [coverUri, coverProp]
  );

  // the live map starts where the picture is (never at the SDK's default view)
  const camera = React.useMemo<CameraProps | undefined>(() => {
    if (!coverCamera) return mapProps.camera;
    const zoomLevel =
      info && info.width > 0 ? zoomToFillScreen(coverCamera.zoomLevel, info, layout) : coverCamera.zoomLevel;
    return { centerCoordinate: coverCamera.centerCoordinate, zoomLevel, pitch: 0, heading: 0, animationMode: 'moveTo' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverCamera?.centerCoordinate[0], coverCamera?.centerCoordinate[1], coverCamera?.zoomLevel, info, layout, mapProps.camera]);
  const canBuild = !coverCamera || layout.width > 0;
  const hasCover = cover !== undefined;
  const coverOpacity = React.useRef(new Animated.Value(hasCover ? 1 : 0)).current;
  const [mapLoaded, setMapLoaded] = React.useState(false);
  const revealed = React.useRef(false);
  const locked = React.useRef(false);
  const touched = React.useRef(false);
  const loadWaiter = React.useRef<(() => void) | undefined>(undefined);
  const [shown, setShown] = React.useState(false);

  const reveal = React.useCallback(() => {
    if (revealed.current || locked.current) return;
    revealed.current = true;
    setShown(true);
    Animated.timing(coverOpacity, { toValue: 0, duration: fadeMs, useNativeDriver: true }).start();
  }, [coverOpacity, fadeMs]);

  React.useImperativeHandle(
    ref,
    () => ({
      showCover() {
        locked.current = true;
        coverOpacity.stopAnimation();
        coverOpacity.setValue(1);
      },
      async captureCover() {
        locked.current = true;
        try {
          const uri = await mapRef.current?.takeSnapshot();
          if (uri) {
            // the picture must be drawn BEFORE it is shown over the map, or the old cover would flash for a moment
            await new Promise<void>((resolve) => {
              loadWaiter.current = resolve;
              setFresh(uri);
              setTimeout(resolve, 400);
            });
          }
        } catch {
          // no picture of the map now: the cover that is there is used
        }
        coverOpacity.stopAnimation();
        coverOpacity.setValue(1);
      },
      takeSnapshot: () => mapRef.current?.takeSnapshot() ?? Promise.reject(new Error('The map is not ready yet')),
      fetchRoute: () => mapRef.current?.fetchRoute() ?? Promise.resolve(),
      startNavigation: () => mapRef.current?.startNavigation() ?? Promise.resolve(),
      stopNavigation: () => mapRef.current?.stopNavigation() ?? Promise.resolve(),
      showOverview: () => mapRef.current?.showOverview() ?? Promise.resolve(),
      recenter: () => mapRef.current?.recenter() ?? Promise.resolve(),
    }),
    [coverOpacity]
  );

  // keep a SCREEN-sized picture of the map for the next time (crisp, labels and pins of the right size)
  React.useEffect(() => {
    if (!shown || !screenId || screenInfo || screenCoverDelayMs <= 0 || layout.width <= 0) return;
    const timer = setTimeout(async () => {
      if (touched.current || locked.current) return; // the user already moved the map: it is not the first view any more
      try {
        const uri = await mapRef.current?.takeSnapshot();
        if (uri && !touched.current && !locked.current) setMapSnapshot(screenId, uri, layout);
      } catch {
        // not now
      }
    }, screenCoverDelayMs);
    return () => clearTimeout(timer);
  }, [shown, screenId, screenInfo, screenCoverDelayMs, layout]);

  // no picture at all: the screen is "ready" at once and the live map is shown as soon as it exists
  React.useEffect(() => {
    if (!hasCover) onCoverLoaded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCover]);

  React.useEffect(() => {
    if (!mount) return;
    if (mapLoaded) {
      reveal();
      return;
    }
    const timer = setTimeout(reveal, timeoutMs);
    return () => clearTimeout(timer);
  }, [mount, mapLoaded, timeoutMs, reveal]);

  return (
    <View
      style={[styles.root, style]}
      onLayout={(e) => setLayout(e.nativeEvent.layout)}
      onTouchStart={() => {
        touched.current = true;
      }}
    >
      {(mount || !hasCover) && canBuild ? (
        <MapboxNavigationView
          {...mapProps}
          ref={mapRef}
          camera={camera}
          style={StyleSheet.absoluteFill}
          onMapLoaded={() => setMapLoaded(true)}
        >
          {children}
        </MapboxNavigationView>
      ) : null}
      {cover ? (
        <Animated.Image
          source={cover}
          resizeMode="cover"
          fadeDuration={0}
          pointerEvents="none"
          onLoad={() => {
            onCoverLoaded?.();
            loadWaiter.current?.();
            loadWaiter.current = undefined;
          }}
          style={[StyleSheet.absoluteFill, { opacity: coverOpacity }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#1c1c1e' },
});
