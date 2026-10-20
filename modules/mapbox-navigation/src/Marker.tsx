import type { MarkerProps } from './MapboxNavigation.types';

/**
 * Declarative marker, used as a child of <MapboxNavigationView>:
 *
 *   <MapboxNavigationView>
 *     <Marker coordinate={{ latitude, longitude }} iconKey="shop" onPress={...}>
 *       <Svg width={32} height={42}>…</Svg>
 *     </Marker>
 *   </MapboxNavigationView>
 *
 * It renders nothing by itself: the parent collects the markers, rasterises each
 * distinct icon ONCE and draws all markers on the GPU inside the map (no native views per marker).
 */
export function Marker(_props: MarkerProps): null {
  return null;
}
(Marker as unknown as { __mapboxMarker: boolean }).__mapboxMarker = true;
