import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { googleApiReferrer } from './googleReferrer.js';

test('defaults to the dev server origin the app is actually opened as', () => {
  assert.equal(googleApiReferrer({}), 'http://localhost:4173/');
});

test('tracks HOST and PORT so the header stays correct when the server moves', () => {
  assert.equal(googleApiReferrer({ HOST: 'gev.local', PORT: '8080' }), 'http://gev.local:8080/');
});

test('a wildcard bind resolves to loopback, never the listen address', () => {
  // Google matches the referrer literally; "0.0.0.0" is never a real origin.
  assert.equal(googleApiReferrer({ HOST: '0.0.0.0', PORT: '4173' }), 'http://localhost:4173/');
  assert.equal(googleApiReferrer({ HOST: '::' }), 'http://localhost:4173/');
});

test('bare IPv6 literals are bracketed into a valid authority', () => {
  assert.equal(googleApiReferrer({ HOST: '::1', PORT: '4173' }), 'http://[::1]:4173/');
});

test('an explicit override wins for self-hosters with a public origin', () => {
  assert.equal(
    googleApiReferrer({ GEV_GOOGLE_REFERRER: 'https://gev.example.com/app' }),
    'https://gev.example.com/app',
  );
});

test('a malformed or non-http override falls back instead of sending garbage', () => {
  // A bad header yields a 403 indistinguishable from a misconfigured key, so
  // the derived origin is the safer failure mode.
  for (const bad of ['not a url', 'ftp://example.com', '   ', 'javascript:alert(1)']) {
    assert.equal(googleApiReferrer({ GEV_GOOGLE_REFERRER: bad }), 'http://localhost:4173/');
  }
});

test('rejects an out-of-range PORT rather than emitting an invalid origin', () => {
  assert.equal(googleApiReferrer({ PORT: '0' }), 'http://localhost:4173/');
  assert.equal(googleApiReferrer({ PORT: '99999' }), 'http://localhost:4173/');
  assert.equal(googleApiReferrer({ PORT: 'abc' }), 'http://localhost:4173/');
});

test('every server-side Google call site sends the referrer header', async () => {
  // A referrer-restricted key 403s any Node-originated call that omits it, so
  // adding a fourth Google fetch without this header must fail the suite.
  const source = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');
  const count = (re) => (source.match(re) || []).length;

  // The server-side Google calls: two Places (New) POSTs keyed by header, and
  // the Street View Static fallback keyed by query param.
  const serverSideGoogleCalls = count(/'X-Goog-Api-Key': apiKey/g)
    + count(/https:\/\/maps\.googleapis\.com\/maps\/api\/streetview'/g);
  assert.equal(serverSideGoogleCalls, 3, 'server-side Google call sites changed - update this guard');

  assert.equal(
    count(/Referer: googleApiReferrer\(process\.env\)/g),
    serverSideGoogleCalls,
    'every server-side Google call must send the referrer header',
  );
});
