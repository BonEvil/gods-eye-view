import { splitFeedRegion } from './feedRegion.js';

/** Union of active browser coverage; one client must never replace another's area. */
export function createFeedRegionLeases({ now = Date.now, ttlMs = 180000, maxClients = 64 } = {}) {
  const clients = new Map();
  let overflowUntil = 0;
  function prune() {
    for (const [id, lease] of clients) if (now() - lease.at >= ttlMs) clients.delete(id);
  }
  return {
    touch(id, region) {
      prune();
      if (!clients.has(id) && clients.size >= maxClients) { overflowUntil = now() + ttlMs; return; }
      clients.set(id, { region, at: now() });
    },
    boxes() {
      prune();
      if (now() < overflowUntil) return [[[-90, -180], [90, 180]]];
      const regions = [...clients.values()].map(x => x.region);
      if (!regions.length) return [];
      if (regions.some(b => !b)) return [[[-90, -180], [90, 180]]];
      const boxes = regions.flatMap(splitFeedRegion).map(([w, s, e, n]) => [[s, w], [n, e]]);
      return [...new Map(boxes.map(b => [JSON.stringify(b), b])).values()];
    },
    clear() { clients.clear(); overflowUntil = 0; },
  };
}
