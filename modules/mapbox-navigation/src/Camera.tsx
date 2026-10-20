import type { CameraProps } from './MapboxNavigation.types';

/**
 * Declarative camera, like <Mapbox.Camera/> from @rnmapbox/maps. Use it as a child of <MapboxNavigationView>:
 *
 *   <MapboxNavigationView>
 *     <Camera
 *       zoomLevel={13}
 *       centerCoordinate={[userLocation.longitude, userLocation.latitude]}
 *       animationMode="flyTo"
 *       animationDuration={1000}
 *     />
 *   </MapboxNavigationView>
 *
 * The camera is applied whenever one of its values changes.
 */
export function Camera(_props: CameraProps): null {
  return null;
}
(Camera as unknown as { __mapboxCamera: boolean }).__mapboxCamera = true;
