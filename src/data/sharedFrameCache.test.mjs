import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSharedFrameCache } from './sharedFrameCache.js';
const frame = size => ({ ok: true, body: Buffer.alloc(size), contentType: 'image/jpeg' });
test('preview, projection and thumbnail share one acquisition and cached frame', async () => {
  let calls = 0, finish, now = 0;
  const cache = createSharedFrameCache({ now: () => now, load: () => { calls++; return new Promise(r => { finish = r; }); } });
  const consumers = [cache.get('camera/source-v1'), cache.get('camera/source-v1'), cache.get('camera/source-v1')];
  await Promise.resolve(); assert.equal(calls, 1); finish(frame(4));
  const results = await Promise.all(consumers);
  assert.equal(results[0], results[1]);
  assert.equal(await cache.get('camera/source-v1'), results[0]);
  now = 10001; const next = cache.get('camera/source-v1'); await Promise.resolve(); assert.equal(calls, 2); finish(null);
  assert.equal((await next).stale, true);
});
test('cache evicts by bytes and entries and isolates source changes', async () => {
  let calls = 0;
  const cache = createSharedFrameCache({ maxBytes: 8, maxEntries: 2, load: async () => { calls++; return frame(5); } });
  await cache.get('a'); await cache.get('b'); await cache.get('a');
  assert.equal(calls, 3);
});
