/**
 * Share the global CCTV source cap fairly across the live open-data packs.
 *
 * The packs are merged in a fixed order and were previously truncated with a
 * plain `slice(0, cap)`. That makes the cap positional: with Austin (250),
 * Caltrans (300), TfL (250) and GDOT (250) all loading, the merged 1,050
 * exceeds the 900 default and the LAST pack absorbs the entire 150-source
 * shortfall — Atlanta lost 60% of its cameras while the other three kept every
 * one. The starvation is silent from the map's point of view: the cameras
 * simply are not there.
 *
 * Round-robin allocation makes the shortfall proportional instead of
 * positional. Each pack has already been distance-sorted against its own
 * anchors by `prioritizeSources`, so taking one at a time from each preserves
 * "nearest first" within every pack while spreading the loss evenly.
 *
 * Explicitly configured sources (file/env, anything outside the live packs) are
 * never round-robined away — they are deliberate operator input, not bulk
 * discovery, so they are seated first.
 */

/** Source kinds produced by the bulk open-data loaders. */
export const LIVE_PACK_KINDS = Object.freeze([
  'austin-open-data',
  'caltrans-open-data',
  'tfl-open-data',
  'gdot-511',
]);

/**
 * Trim a merged source catalog to `maxCount`, sharing the cut across packs.
 *
 * @param {Array<object>} sources - Merged, deduplicated source objects.
 * @param {number} maxCount - Global cap.
 * @param {ReadonlyArray<string>} [livePackKinds] - Kinds subject to round-robin.
 * @returns {Array<object>} At most `maxCount` sources.
 */
export function allocateSourceBudget(sources, maxCount, livePackKinds = LIVE_PACK_KINDS) {
  const list = Array.isArray(sources) ? sources : [];
  if (!Number.isFinite(maxCount) || maxCount <= 0) return [];
  if (list.length <= maxCount) return list;

  const packKinds = new Set(livePackKinds);

  // Operator-configured sources outrank bulk discovery and are seated first.
  const pinned = list.filter((s) => !packKinds.has(String(s?.sourceKind || '')));
  if (pinned.length >= maxCount) return pinned.slice(0, maxCount);

  // Group the live packs, preserving both first-appearance order across groups
  // and each pack's internal distance ordering.
  const groups = new Map();
  for (const source of list) {
    const kind = String(source?.sourceKind || '');
    if (!packKinds.has(kind)) continue;
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(source);
  }

  const selected = [];
  const budget = maxCount - pinned.length;
  const queues = Array.from(groups.values());
  let cursor = 0;
  while (selected.length < budget) {
    let progressed = false;
    for (const queue of queues) {
      if (cursor >= queue.length) continue;
      selected.push(queue[cursor]);
      progressed = true;
      if (selected.length >= budget) break;
    }
    if (!progressed) break; // every queue exhausted
    cursor += 1;
  }

  return [...pinned, ...selected];
}

/**
 * Summarize how many sources each pack contributed, for operator logging.
 *
 * @param {Array<object>} sources
 * @returns {string} e.g. "austin-open-data=225, gdot-511=225"
 */
export function describeSourceMix(sources) {
  const counts = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    const kind = String(source?.sourceKind || 'unknown');
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([kind, n]) => `${kind}=${n}`)
    .join(', ');
}
