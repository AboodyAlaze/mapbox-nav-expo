import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type NativeModuleShape = {
  setAccessToken(token: string): void;
  hasAccessToken(): boolean;
  getAccessToken(): string;
};

const NativeModule =
  (Platform.OS === 'android' || Platform.OS === 'ios')
    ? requireOptionalNativeModule<NativeModuleShape>('MapboxNavigation')
    : null;

/** True when the native module is linked (false in Expo Go / iOS / web). */
export const isNativeModuleAvailable = NativeModule != null;

/**
 * Sets the Mapbox PUBLIC access token (pk.…) at runtime.
 * Optional – the token from app.json (plugin option `accessToken`) is used by default.
 * Must be called before <MapboxNavigationView /> mounts.
 */
export function setAccessToken(token: string): void {
  NativeModule?.setAccessToken(token);
}

export function hasAccessToken(): boolean {
  return NativeModule?.hasAccessToken() ?? false;
}

/** Returns the public access token currently used by the SDK (handy for Geocoding / Search REST calls). */
export function getAccessToken(): string {
  return NativeModule?.getAccessToken() ?? '';
}
