import * as Cesium from 'cesium';
import { bufferFeedRegion } from './feedRegion.js';

/** Cesium's ground rectangle accounts for tilt; camera latitude alone does not. */
export function viewFeedRegion(viewer, target = null) {
  let rect;
  try { rect = viewer?.camera?.computeViewRectangle?.(viewer.scene?.globe?.ellipsoid); } catch { /* sky-only view */ }
  if (!rect) return null; // no reliable footprint: retain global overview semantics
  return bufferFeedRegion([rect.west, rect.south, rect.east, rect.north].map(Cesium.Math.toDegrees), target);
}
export function regionalFeedUrl(base, viewer, { keep = '', target = null } = {}) {
  const region = viewFeedRegion(viewer, target);
  const url = new URL(base, 'http://localhost');
  if (region) url.searchParams.set('bbox', region.join(','));
  if (keep) url.searchParams.set('keep', keep);
  return /^https?:/i.test(base) ? url.toString() : `${url.pathname}${url.search}`;
}

/** Camera-settle refreshes share a minimum spacing with normal manager polls. */
export function installRegionalRefresh(layer, { intervalMs = 12000 } = {}) {
  const update = layer.update;
  let viewer, remove, removeStart, timer, last = 0, running = false, active = false, lastRegion = '';
  function stop() { active = false; remove?.(); removeStart?.(); remove = null; removeStart = null; clearTimeout(timer); timer = null; }
  layer.update = async function(v, options) {
    if (running) return;
    last = Date.now(); running = true;
    try { return await update.call(this, v, options); }
    finally { running = false; }
  };
  function settled() {
    clearTimeout(timer);
    const region = JSON.stringify(viewFeedRegion(viewer));
    if (region === lastRegion) return;
    timer = setTimeout(async () => {
      if (!active) return;
      if (running) { settled(); return; }
      lastRegion = region;
      await layer.update(viewer);
    }, Math.max(500, intervalMs - (Date.now() - last)));
  }
  function start(v) {
    stop(); active = true; viewer = v;
    lastRegion = JSON.stringify(viewFeedRegion(viewer));
    remove = viewer?.camera?.moveEnd?.addEventListener(settled);
    removeStart = viewer?.camera?.moveStart?.addEventListener(() => { clearTimeout(timer); timer = null; });
  }
  return { start, stop };
}
