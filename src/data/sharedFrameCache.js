/** Bounded server-side still-frame cache. Request lifetimes never own shared fetches. */
export function createSharedFrameCache({ load, now = Date.now, ttlMs = 10000, staleMs = 60000, maxEntries = 128, maxPending = 8, maxBytes = 32 * 1024 * 1024 } = {}) {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (entry) bytes -= entry.value.body.byteLength;
    entries.delete(key);
  }
  return {
    async get(key) {
      if (!key) return null;
      for (const [id, entry] of entries) if (now() - entry.at >= staleMs) remove(id);
      const cached = entries.get(key);
      if (cached && now() - cached.at < ttlMs) return cached.value;
      if (pending.has(key)) return pending.get(key);
      // Bound simultaneous acquisitions as well as retained frame bytes.
      if (pending.size >= maxPending) return cached ? { ...cached.value, stale: true } : null;
      const promise = Promise.resolve().then(() => load(key)).catch(() => null).then(value => {
        if (!value?.ok) return cached && now() - cached.at < staleMs ? { ...cached.value, stale: true } : null;
        remove(key);
        if (value.body.byteLength <= maxBytes) {
          entries.set(key, { value, at: now() });
          bytes += value.body.byteLength;
          while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
        }
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, promise);
      return promise;
    },
  };
}
