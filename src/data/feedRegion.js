/** Shared geographic policy. Bounds use degrees and west > east crosses the dateline. */
export function normalizeLongitude(value) { return ((value + 180) % 360 + 360) % 360 - 180; }
export function parseFeedRegion(params) {
  if (!params.has('bbox')) return null;
  const parts = params.get('bbox').split(',');
  const b = parts.map(Number);
  if (parts.length !== 4 || parts.some(p => !p.trim()) || !b.every(Number.isFinite)
    || Math.abs(b[0]) > 180 || Math.abs(b[2]) > 180 || b[1] < -90 || b[3] > 90 || b[1] >= b[3] || b[0] === b[2]) throw new Error('Invalid feed bbox');
  return b;
}
export function inFeedRegion(bounds, lon, lat) {
  if (!bounds) return true;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  return lat >= bounds[1] && lat <= bounds[3] && (bounds[0] <= bounds[2]
    ? lon >= bounds[0] && lon <= bounds[2] : lon >= bounds[0] || lon <= bounds[2]);
}
export function splitFeedRegion(b) {
  if (!b) return [[-180, -90, 180, 90]];
  return b[0] <= b[2] ? [b] : [[b[0], b[1], 180, b[3]], [-180, b[1], b[2], b[3]]].filter(part => part[0] < part[2]);
}
/** Pad and snap outwards to reusable half-degree cells; include a tracked target. */
export function bufferFeedRegion(bounds, target = null) {
  let [west, south, east, north] = bounds;
  let width = east >= west ? east - west : east + 360 - west;
  const padX = Math.max(0.5, width * 0.25);
  const padY = Math.max(0.5, (north - south) * 0.25);
  west -= padX; east = west + width + 2 * padX;
  south -= padY; north += padY;
  if (target && Number.isFinite(target.lon) && Number.isFinite(target.lat)) {
    let lon = target.lon;
    while (lon < west) lon += 360;
    if (lon > east) {
      if (lon - east < west - (lon - 360)) east = lon + 0.5;
      else west = lon - 360 - 0.5;
    }
    south = Math.min(south, target.lat - 0.5); north = Math.max(north, target.lat + 0.5);
  }
  west = Math.floor(west * 2) / 2; east = Math.ceil(east * 2) / 2;
  south = Math.max(-90, Math.floor(south * 2) / 2); north = Math.min(90, Math.ceil(north * 2) / 2);
  return east - west >= 360 ? [-180, south, 180, north] : [normalizeLongitude(west), south, normalizeLongitude(east), north];
}
/** Filter before caps. Selected identity gets a reserved slot. */
export function selectFeedRows(rows, bounds, keep, limit, position, identity) {
  const selected = keep ? rows.find(row => String(identity(row)) === keep) : null;
  const result = selected ? [selected] : [];
  for (const row of rows) {
    if (result.length >= limit) break;
    if (row === selected) continue;
    const p = position(row);
    if (inFeedRegion(bounds, p.lon, p.lat)) result.push(row);
  }
  return result;
}
