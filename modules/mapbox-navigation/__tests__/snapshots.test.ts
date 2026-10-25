import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearMapSnapshot,
  getMapSnapshot,
  getMapSnapshotInfo,
  setMapSnapshot,
  snapshotId,
  subscribeMapSnapshots,
  zoomToFillScreen,
  coverFitsLayout,
} from '../src/snapshots';

describe('map pictures', () => {
  it('light and dark maps are different pictures; "system" follows the phone', () => {
    assert.equal(snapshotId('office', 'system', 'dark'), 'office:dark');
    assert.equal(snapshotId('office', 'system', 'light'), 'office:light');
    assert.equal(snapshotId('office', 'system', null), 'office:light');
    assert.equal(snapshotId('office', 'dark', 'light'), 'office:dark');
    assert.equal(snapshotId('office', 'light', 'dark'), 'office:light');
    assert.equal(snapshotId('office', undefined, 'dark'), 'office:dark');
  });

  it('keeps a picture, tells the listeners and forgets it', () => {
    clearMapSnapshot();
    let calls = 0;
    const off = subscribeMapSnapshots(() => calls++);
    assert.equal(getMapSnapshot('office:dark'), undefined);
    setMapSnapshot('office:dark', 'file:///cache/a.png');
    assert.equal(getMapSnapshot('office:dark'), 'file:///cache/a.png');
    assert.equal(calls, 1);
    clearMapSnapshot('office:dark');
    assert.equal(getMapSnapshot('office:dark'), undefined);
    assert.equal(calls, 2);
    off();
    setMapSnapshot('office:light', 'file:///cache/b.png');
    assert.equal(calls, 2, 'unsubscribed');
    clearMapSnapshot();
  });
});

describe('the live map starts exactly where the card picture is', () => {
  it('raises the zoom by log2 of the "cover" scale', () => {
    // card 380x300 stretched over a 400x900 screen: scale = max(400/380, 900/300) = 3
    const z = zoomToFillScreen(3, { width: 380, height: 300 }, { width: 400, height: 900 });
    assert.ok(Math.abs(z - (3 + Math.log2(3))) < 1e-9);
  });
  it('keeps the zoom when the sizes are not known yet', () => {
    assert.equal(zoomToFillScreen(3, { width: 0, height: 0 }, { width: 400, height: 900 }), 3);
    assert.equal(zoomToFillScreen(3, { width: 380, height: 300 }, { width: 0, height: 0 }), 3);
  });
  it('a card as big as the screen needs no change', () => {
    assert.equal(zoomToFillScreen(5, { width: 400, height: 900 }, { width: 400, height: 900 }), 5);
  });
  it('stores the size of the card with its picture', () => {
    clearMapSnapshot();
    setMapSnapshot('office:dark', 'file:///a.png', { width: 380, height: 300 });
    assert.deepEqual(getMapSnapshotInfo('office:dark'), { uri: 'file:///a.png', width: 380, height: 300 });
    setMapSnapshot('office:light', 'file:///b.png');
    assert.deepEqual(getMapSnapshotInfo('office:light'), { uri: 'file:///b.png', width: 0, height: 0 });
    clearMapSnapshot();
  });
});

describe('a screen-sized cover', () => {
  it('fits a screen of the same shape, not a card, and is trusted while the size is unknown', () => {
    assert.equal(coverFitsLayout({ width: 411, height: 890 }, { width: 411, height: 892 }), true);
    assert.equal(coverFitsLayout({ width: 380, height: 300 }, { width: 411, height: 890 }), false);
    assert.equal(coverFitsLayout({ width: 411, height: 890 }, { width: 0, height: 0 }), true);
    assert.equal(coverFitsLayout({ width: 0, height: 0 }, { width: 411, height: 890 }), false);
  });
});
