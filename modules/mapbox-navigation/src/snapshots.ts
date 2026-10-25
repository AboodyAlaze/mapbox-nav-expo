/**
 * Pictures of maps, taken by the map itself (see `FrozenMap`) and kept in memory (the files live in the cache).
 * Plain TypeScript, no React Native: easy to test.
 */
export type SnapshotScheme = 'light' | 'dark' | null | undefined;

/** `office` + a theme → `office:dark`. Light and dark maps are different pictures. */
export function snapshotId(key: string, theme: 'system' | 'light' | 'dark' | undefined, scheme: SnapshotScheme): string {
  const mode = theme === 'dark' || theme === 'light' ? theme : scheme === 'dark' ? 'dark' : 'light';
  return `${key}:${mode}`;
}

export type MapSnapshot = {
  uri: string;
  /** Size of the view the picture was taken from, in dp (what a screen needs to place the live map exactly like it). */
  width: number;
  height: number;
};

const snapshots = new Map<string, MapSnapshot>();
const listeners = new Set<() => void>();

export function setMapSnapshot(id: string, uri: string, size?: { width: number; height: number }) {
  snapshots.set(id, { uri, width: size?.width ?? 0, height: size?.height ?? 0 });
  listeners.forEach((l) => l());
}

export function getMapSnapshot(id: string): string | undefined {
  return snapshots.get(id)?.uri;
}

export function getMapSnapshotInfo(id: string): MapSnapshot | undefined {
  return snapshots.get(id);
}

/** Forget a picture (or all of them): the next `FrozenMap` takes a new one. */
export function clearMapSnapshot(id?: string) {
  if (id) snapshots.delete(id);
  else snapshots.clear();
  listeners.forEach((l) => l());
}

export function subscribeMapSnapshots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The picture of a card is stretched with "cover" over a bigger screen: it is scaled by the larger of the two ratios.
 * A live map shows the same area at the same scale when its zoom is raised by log2(scale). Without it the picture and
 * the map are two different views of the world and the "shared element" jumps.
 */
export function zoomToFillScreen(
  cardZoom: number,
  card: { width: number; height: number },
  screen: { width: number; height: number }
): number {
  if (card.width <= 0 || card.height <= 0 || screen.width <= 0 || screen.height <= 0) return cardZoom;
  const scale = Math.max(screen.width / card.width, screen.height / card.height);
  return cardZoom + Math.log2(scale);
}

/**
 * Does a picture taken from a view of size `info` fit a view of size `layout` (same shape, so it is not stretched)?
 * While the size of the view is still unknown (0) the picture is trusted.
 */
export function coverFitsLayout(
  info: { width: number; height: number },
  layout: { width: number; height: number }
): boolean {
  if (info.width <= 0 || info.height <= 0) return false;
  if (layout.width <= 0 || layout.height <= 0) return true;
  return Math.abs(info.width / info.height - layout.width / layout.height) < 0.03;
}
