/**
 * Resolve the `Referer` header this server sends on its own Google API calls.
 *
 * GOOGLE_MAPS_API_KEY is used from two places with incompatible restriction
 * models. The browser bundle reads it via `import.meta.env` (Map Tiles for
 * photorealistic 3D, Geocoding for place search), which is why the key must
 * carry an HTTP-referrer restriction — it is visible in devtools by design and
 * an unrestricted key there is free quota for anyone who loads the page.
 *
 * But three routes call Google from Node, not the browser:
 *   - `/api/google/nearby-places`  -> places:searchNearby
 *   - `/api/google/text-search`    -> places:searchText
 *   - CCTV frame fallback          -> Street View Static
 *
 * `fetch` in Node sends no Referer, so a referrer-restricted key answers those
 * three with 403 REQUEST_DENIED. Sending a Referer that matches the key's own
 * allow-list is not a bypass: referrer restrictions are a client-side hint that
 * any HTTP client can set, and this is the key owner's own server declaring the
 * origin it is serving. Real spend protection is GEV_RATELIMIT_GOOGLE_PER_MIN
 * plus provider-side budget alerts (see .env.example and SECURITY.md).
 *
 * The default tracks the dev server's own origin so the value stays correct
 * when HOST/PORT move. Self-hosters whose key is restricted to a public origin
 * override it with GEV_GOOGLE_REFERRER.
 *
 * @param {Record<string, string|undefined>} [env=process.env] - Environment source.
 * @returns {string} An absolute http(s) URL, always non-empty.
 */
export function googleApiReferrer(env = process.env) {
  const source = env || {};

  // Explicit override wins, but only when it parses as an http(s) URL — a
  // malformed value must not silently become the header, because the resulting
  // 403 looks identical to a misconfigured key in the Cloud console.
  const override = String(source.GEV_GOOGLE_REFERRER || '').trim();
  if (override) {
    try {
      const parsed = new URL(override);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {
      // fall through to the derived origin
    }
  }

  // A wildcard bind ("0.0.0.0"/"::") is a listen address, not an origin a
  // browser would ever send. Google matches the referrer literally, so fall
  // back to the loopback name the app is actually opened as.
  const rawHost = String(source.HOST || '').trim();
  const host = (!rawHost || rawHost === '0.0.0.0' || rawHost === '::') ? 'localhost' : rawHost;

  const parsedPort = parseInt(String(source.PORT || ''), 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536
    ? parsedPort
    : 4173;

  // Bare IPv6 literals need brackets to form a valid authority.
  const authority = (host.includes(':') && !host.startsWith('[')) ? `[${host}]` : host;
  return `http://${authority}:${port}/`;
}
