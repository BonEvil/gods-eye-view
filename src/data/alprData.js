export const ALPR_LIMIT = 2000;
const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const clean = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';

export function alprDirection(value) {
  const text = clean(value).toUpperCase();
  if (!text) return null;
  const point = compass.indexOf(text);
  if (point >= 0) return point * 22.5;
  if (!/^\d+(?:\.\d+)?°?$/.test(text)) return null;
  const degrees = Number(text.replace('°', ''));
  return degrees <= 360 ? degrees % 360 : null;
}

/** Stable snapped regions; global and sky-only views ask the user to zoom in. */
export function alprBoxes(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return [];
  const [west,south,east,north] = bounds;
  const width = east < west ? 360 - west + east : east - west;
  if (south < -90 || north > 90 || west < -180 || east > 180 || west > 180 || east < -180 || north <= south || width <= 0 || width > 2 || north - south > 2) return [];
  const parts = west <= east ? [[west,south,east,north]] : [[west,south,180,north],[-180,south,east,north]];
  return parts.filter(b => b[0] < b[2]).map(([w,s,e,n]) => [Math.floor(w*4)/4,Math.floor(s*4)/4,Math.ceil(e*4)/4,Math.ceil(n*4)/4]);
}

export function alprQuery(boxes) {
  if (!boxes.length || boxes.length > 2) throw new Error('ALPR queries require a local view');
  return `[out:json][timeout:25];(${boxes.map(([w,s,e,n]) => `nwr["man_made"="surveillance"]["surveillance:type"="ALPR"](${s},${w},${n},${e});`).join('')});out meta center ${ALPR_LIMIT+1};`;
}

export function normalizeAlpr(payload) {
  if (!Array.isArray(payload?.elements) || payload.remark) throw new Error('ALPR mapping query did not complete');
  const unique = new Map();
  for (const el of payload.elements) {
    const tags = el.tags || {};
    if (tags.man_made !== 'surveillance' || tags['surveillance:type'] !== 'ALPR') continue;
    if (!['node','way','relation'].includes(el.type) || !Number.isSafeInteger(el.id) || el.id <= 0) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) continue;
    const id = `alpr:${el.type}:${el.id}`;
    unique.set(id, { id, lat, lon, name: clean(tags.name) || 'ALPR camera', manufacturer: clean(tags.manufacturer), model: clean(tags.model), cameraType: clean(tags['camera:type']), operator: clean(tags.operator), mount: clean(tags['camera:mount']), zone: clean(tags['surveillance:zone']), direction: alprDirection(tags['camera:direction'] || tags.direction), editedAt: clean(el.timestamp), checkedAt: clean(tags['check_date:surveillance'] || tags.check_date), osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}` });
  }
  return { records: [...unique.values()].slice(0, ALPR_LIMIT), truncated: payload.elements.length > ALPR_LIMIT, snapshotAt: clean(payload.osm3s?.timestamp_osm_base) };
}
