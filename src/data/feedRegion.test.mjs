import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bufferFeedRegion, inFeedRegion, parseFeedRegion, selectFeedRows, splitFeedRegion } from './feedRegion.js';
import { viewFeedRegion, regionalFeedUrl, installRegionalRefresh } from './viewFeedRegion.js';
import { createFeedRegionLeases } from './feedRegionLeases.js';

test('buffered regions cross the dateline and retain selected targets', () => {
  const bounds = bufferFeedRegion([178, -2, -178, 2], { lon: -174, lat: 3 });
  assert.equal(inFeedRegion(bounds, 179, 0), true);
  assert.equal(inFeedRegion(bounds, -179, 0), true);
  assert.equal(inFeedRegion(bounds, -174, 3), true);
  assert.equal(inFeedRegion(bounds, 0, 0), false);
  assert.equal(splitFeedRegion(bounds).length, 2);
  assert.deepEqual(splitFeedRegion([179, -1, -180, 1]), [[179, -1, 180, 1]]);
  assert.deepEqual(bufferFeedRegion([-180, -90, 180, 90]), [-180, -90, 180, 90]);
});
test('reject malformed regions before provider requests', () => {
  for (const bbox of ['', '1,2,3', '0,0,0,1', '0,-91,1,2', 'NaN,0,1,2', ',0,1,2']) {
    assert.throws(() => parseFeedRegion(new URLSearchParams({ bbox })));
  }
});
test('filter before cap and reserve the selected vessel outside the view', () => {
  const rows = [{ id: 'far', lon: 0, lat: 0 }, { id: 'near', lon: 10, lat: 10 }, { id: 'selected', lon: 50, lat: 50 }];
  assert.deepEqual(selectFeedRows(rows, [9, 9, 11, 11], 'selected', 2, r => r, r => r.id).map(r => r.id), ['selected', 'near']);
});
test('ground footprint, rather than camera coordinates, determines request bounds', () => {
  const viewer = { scene: {}, camera: { positionCartographic: { longitude: 0, latitude: 0 }, computeViewRectangle: () => ({ west: 1, east: 1.01, south: 0.5, north: 0.51 }) } };
  assert.equal(inFeedRegion(viewFeedRegion(viewer), 57.5, 29), true);
  assert.equal(inFeedRegion(viewFeedRegion(viewer), 0, 0), false);
  assert.match(regionalFeedUrl('/api/ais-live?maxRows=500', viewer, { keep: '123' }), /maxRows=500.*bbox=.*keep=123/);
  assert.equal(viewFeedRegion({ camera: {} }), null);
});
test('AIS leases retain other tabs, expire, split dateline, and bound client memory', () => {
  let now = 0;
  const leases = createFeedRegionLeases({ now: () => now, ttlMs: 100, maxClients: 2 });
  leases.touch('a', [170, -10, -170, 10]);
  leases.touch('b', [0, 0, 10, 10]);
  assert.equal(leases.boxes().length, 3);
  now = 50; leases.touch('a', [1, 1, 2, 2]);
  assert.equal(leases.boxes().length, 2);
  now = 101; assert.equal(leases.boxes().length, 1);
  leases.touch('b', [0, 0, 1, 1]); leases.touch('c', [0, 0, 1, 1]);
  assert.deepEqual(leases.boxes(), [[[-90, -180], [90, 180]]]);
  now = 202; assert.deepEqual(leases.boxes(), []);
});
test('regional refresh does not overlap manager polls and removes listeners on disable', async () => {
  const handlers = new Set();
  const event = { addEventListener(fn) { handlers.add(fn); return () => handlers.delete(fn); } };
  let finish, calls = 0;
  const layer = { update: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  const refresh = installRegionalRefresh(layer);
  refresh.start({ camera: { moveEnd: event, moveStart: event } });
  const first = layer.update(); await layer.update();
  assert.equal(calls, 1);
  refresh.stop(); assert.equal(handlers.size, 0);
  finish(); await first;
});
