import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSkyProxy, adsbLolProxy, installFeedResponseFilter } from '../../vite.config.js';

function middleware(plugin) {
  let handler;
  plugin.configureServer({ middlewares: { use(_path, fn) { handler = fn; } } });
  return handler;
}
async function call(handler, url) {
  const result = {};
  await handler({ url }, { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = JSON.parse(body); } });
  return result;
}
test('OpenSky bounds reach upstream; concurrent identical requests share a snapshot; regions never reuse wrong cache', async () => {
  const original = fetch, auth = process.env.OPENSKY_AUTH_MODE;
  process.env.OPENSKY_AUTH_MODE = 'anon';
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify({ time: Date.now() / 1000, states: [['near', '', '', 0, 0, 10, 10], ['far', '', '', 0, 0, 50, 50]] }), { headers: { 'x-rate-limit-remaining': '4000' } });
  };
  try {
    const handler = middleware(openSkyProxy());
    const [a, b] = await Promise.all([call(handler, '/?bbox=9,9,11,11'), call(handler, '/?bbox=9,9,11,11')]);
    assert.equal(urls.length, 1);
    const upstream = new URL(urls[0]);
    assert.equal(upstream.searchParams.get('lamin'), '9');
    assert.equal(upstream.searchParams.get('lomax'), '11');
    assert.equal(a.body.states.length, 1); assert.deepEqual(a.body, b.body);
    const other = await call(handler, '/?bbox=49,49,51,51');
    assert.equal(other.status, 429, 'new region respects shared governor instead of spending on each camera move');
    assert.equal(urls.length, 1);
    assert.equal((await call(handler, '/?bbox=bad')).status, 400);
  } finally { globalThis.fetch = original; if (auth === undefined) delete process.env.OPENSKY_AUTH_MODE; else process.env.OPENSKY_AUTH_MODE = auth; }
});
test('military cached snapshot filters separately per client and reserves tracked aircraft', async () => {
  const original = fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ac: [{ hex: 'a', lon: 10, lat: 10 }, { hex: 'b', lon: 50, lat: 50 }] })); };
  try {
    const handler = middleware(adsbLolProxy());
    const a = await call(handler, '/?bbox=9,9,11,11');
    const b = await call(handler, '/?bbox=49,49,51,51&keep=a');
    assert.equal(calls, 1); assert.equal(a.body.ac.length, 1); assert.equal(b.body.ac.length, 2);
  } finally { globalThis.fetch = original; }
});
test('dateline serialization keeps both sides and excludes Greenwich', async () => {
  const result = await call((req, res) => {
    installFeedResponseFilter(req, res, 'ac');
    res.writeHead(200, {}); res.end(JSON.stringify({ ac: [{ hex: 'a', lon: 179, lat: 0 }, { hex: 'b', lon: -179, lat: 0 }, { hex: 'c', lon: 0, lat: 0 }] }));
  }, '/?bbox=170,-10,-170,10');
  assert.equal(result.body.ac.length, 2);
});
