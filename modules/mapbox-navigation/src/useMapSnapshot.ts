import * as React from 'react';
import { useColorScheme } from 'react-native';

import { getMapSnapshotInfo, snapshotId, subscribeMapSnapshots, type MapSnapshot } from './snapshots';

/** The picture saved under `id`, with the size of the view it came from (`undefined` until it exists). */
export function useMapSnapshotInfo(id: string | undefined): MapSnapshot | undefined {
  return React.useSyncExternalStore(
    subscribeMapSnapshots,
    () => (id ? getMapSnapshotInfo(id) : undefined),
    () => undefined
  );
}

/** The `file://` uri of the picture saved under `id` (`undefined` until it exists). */
export function useMapSnapshot(id: string | undefined): string | undefined {
  return useMapSnapshotInfo(id)?.uri;
}

/**
 * Is the picture of `key` (for the current theme) ready? Use it to enable a card that opens a screen only when the
 * card can be photographed by a screen transition.
 */
export function useMapSnapshotReady(key: string, theme: 'system' | 'light' | 'dark' = 'system'): boolean {
  const scheme = useColorScheme();
  return useMapSnapshot(snapshotId(key, theme, scheme)) !== undefined;
}
