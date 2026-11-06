import type { MarkerProps } from './MapboxNavigation.types';

/**
 * Declarative marker, used as a child of <MapboxNavigationView>:
 *
 *   <Marker coordinate={{ latitude, longitude }} {...MapIcons.building} onPress={...} />
 *   <Marker coordinate={...} svg={mySvgString} size={{ width: 32, height: 42 }} />
 *   <Marker coordinate={...} image={require('./pin.png')} size={40} />
 *
 * It renders nothing by itself: the parent collects the markers and the NATIVE side draws each distinct picture ONCE
 * (SVG markup is drawn as vector at the device density), then draws all markers on the GPU inside the map.
 * Children (react-native-svg views) are no longer used on Android.
 */
export function Marker(_props: MarkerProps): null {
  return null;
}
(Marker as unknown as { __mapboxMarker: boolean }).__mapboxMarker = true;
