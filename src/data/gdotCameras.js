/**
 * Parse Georgia DOT 511 camera records into GEV CCTV source objects.
 *
 * GDOT publishes ~4,330 statewide cameras through the 511ga.org list endpoint.
 * Two things shape this module:
 *
 *   1. **Snapshots only.** Every record also carries an HLS `videoUrl` on
 *      `navigator.dot.ga.gov`, but those are flagged `isVideoAuthRequired` and
 *      answer 401 without GDOT credentials (verified 2026-09-10). Only the
 *      still-image endpoint is public, so these are `feedType: 'image'` — the
 *      same shape as Austin and Caltrans, refreshed on the client cadence.
 *
 *   2. **Coordinates arrive as WKT**, nested under `latLng.geography`, in
 *      LONGITUDE-FIRST order per the OGC spec — the opposite of the lat/lon
 *      field pairs every other pack uses. Reading that pair positionally
 *      without swapping puts Atlanta in the Indian Ocean, so the parse is
 *      explicit about which capture group is which.
 */

/** Longitude/latitude bounds of Georgia, used to reject transposed or garbage coordinates. */
const GEORGIA_BOUNDS = Object.freeze({ minLat: 30.3, maxLat: 35.1, minLon: -85.7, maxLon: -80.7 });

/**
 * Parse an OGC WKT POINT into a lat/lon pair.
 *
 * WKT is `POINT (lon lat)` — longitude first. Returns null for any malformed
 * input rather than throwing, because one bad row must not abort a 4,000-row
 * catalog parse.
 *
 * @param {string} wkt - e.g. "POINT (-84.91445 34.37697)"
 * @returns {{lat: number, lon: number}|null}
 */
export function parseWktPoint(wkt) {
  const match = /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$/i.exec(String(wkt || ''));
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/**
 * Check a coordinate falls inside Georgia.
 *
 * A transposed pair (lat/lon swapped) lands near (-84, 34) which is in the
 * Pacific, so this catches the most likely parse bug as well as upstream junk.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function isLikelyGeorgiaCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= GEORGIA_BOUNDS.minLat && lat <= GEORGIA_BOUNDS.maxLat
    && lon >= GEORGIA_BOUNDS.minLon && lon <= GEORGIA_BOUNDS.maxLon;
}

/**
 * Pick the first usable image off a GDOT record.
 *
 * A camera site can carry several image entries; disabled/blocked ones are
 * present in the payload but serve nothing, so they are skipped rather than
 * becoming cameras that permanently fail to load a frame.
 *
 * @param {object} record
 * @returns {object|null}
 */
export function pickGdotImage(record) {
  const images = Array.isArray(record?.images) ? record.images : [];
  return images.find((img) => (
    img && !img.disabled && !img.blocked && typeof img.imageUrl === 'string' && img.imageUrl.trim()
  )) || null;
}

/**
 * Strip the leading camera code from a GDOT location string.
 *
 * `location` reads "ATL-0602: SR 13 at Lenox Rd (Atlanta)". The code duplicates
 * the id we already build, so the label keeps only the human part.
 *
 * @param {string} location
 * @returns {string}
 */
export function gdotLabel(location) {
  return String(location || '').replace(/^[A-Z]{2,6}-\d{3,5}:\s*/i, '').trim();
}

/**
 * Convert one GDOT 511 record into a GEV CCTV source object.
 *
 * @param {object} record - Raw row from the 511ga.org list endpoint.
 * @param {object} [opts]
 * @param {string} [opts.origin='https://511ga.org'] - Origin for relative image URLs.
 * @param {(value: string, allowBare: boolean) => number} [opts.headingFrom] - Direction parser.
 * @param {(id: string) => number} [opts.fallbackHeading] - Deterministic heading when direction is absent.
 * @returns {object|null} Normalized source, or null when the record is unusable.
 */
export function gdotCameraFromRecord(record, opts = {}) {
  const origin = opts.origin || 'https://511ga.org';
  const headingFrom = typeof opts.headingFrom === 'function' ? opts.headingFrom : () => NaN;
  const fallbackHeading = typeof opts.fallbackHeading === 'function' ? opts.fallbackHeading : () => 0;

  if (!record || record.visible === false) return null;

  const point = parseWktPoint(record?.latLng?.geography?.wellKnownText);
  if (!point || !isLikelyGeorgiaCoordinate(point.lat, point.lon)) return null;

  const image = pickGdotImage(record);
  if (!image) return null;

  const siteId = String(record.id ?? record.DT_RowId ?? '').trim();
  if (!siteId) return null;
  const cameraId = `ga-gdot-${siteId}-${image.id}`;

  // `direction` is a dedicated facing field ("Eastbound"), not free-form text,
  // so bare cardinals are safe to accept here — same call Caltrans makes.
  const heading = headingFrom(record.direction, true);
  const hasHeading = Number.isFinite(heading);

  const label = gdotLabel(record.location) || String(image.description || '').trim() || `GDOT ${siteId}`;
  const imageUrl = /^https?:\/\//i.test(image.imageUrl)
    ? image.imageUrl
    : `${origin}${image.imageUrl.startsWith('/') ? '' : '/'}${image.imageUrl}`;

  return {
    id: cameraId,
    name: record.roadway ? `${label} (${String(record.roadway).trim()})` : label,
    city: 'Atlanta',
    cityId: 'atlanta',
    provider: 'Georgia DOT 511',
    lat: point.lat,
    lon: point.lon,
    headingDeg: hasHeading ? heading : fallbackHeading(cameraId),
    headingConfidence: hasHeading ? 'high' : 'low',
    // Same two fabricated pose personalities as Austin and Caltrans: raw priors
    // only. The client's ground snap and manual calibration own the truth.
    pitchDeg: hasHeading ? -24 : -18,
    fovDeg: hasHeading ? 56 : 44,
    rangeM: hasHeading ? 210 : 145,
    mountHeightM: hasHeading ? 10 : 8,
    // GDOT publishes no per-camera elevation. Metro Atlanta sits near 300 m and
    // the Piedmont is gentle, so a constant is a better prior than 0 on stacks
    // where the client's tile snap can't correct it (keyless OSM).
    groundElevationM: 300,
    feedType: 'image',
    url: imageUrl,
    snapshotUrl: imageUrl,
    sourceKind: 'gdot-511',
    license: 'Public Georgia DOT 511 traffic camera frame',
  };
}
