import * as Cesium from 'cesium';
import { isPickOwnedByLayer, resolvePickId, isOwnedByOtherLayer } from './pickRegistry.js';
import { selectTrackedSubjectContext, selectEntityContext, clearSelectedEntityContextForLayer } from './contextStore.js';

export const AIRCRAFT_PICK_SIZE_PX = 44;
const returnViews = new WeakMap();
const details = new WeakMap();
const activeStops = new WeakMap();

/** Keep precise picks authoritative; near misses get a generous aircraft-only aperture. */
export function pickAircraft(scene, position) {
  const exact = scene.pick(position);
  if (exact && (exact.id?.gevTrackedId || isOwnedByOtherLayer('', resolvePickId(exact)))) return exact;
  const candidates = scene.drillPick?.(position, 32, AIRCRAFT_PICK_SIZE_PX, AIRCRAFT_PICK_SIZE_PX) || [];
  let nearest = null;
  let distance = Infinity;
  for (const picked of candidates) {
    const id = resolvePickId(picked);
    if (!isPickOwnedByLayer('flights', id) && !isPickOwnedByLayer('military', id)) continue;
    const world = picked.primitive?.position;
    const screen = world ? Cesium.SceneTransforms.worldToWindowCoordinates(scene, world) : null;
    const d = screen ? Math.hypot(screen.x - position.x, screen.y - position.y) : AIRCRAFT_PICK_SIZE_PX;
    if (d < distance) { nearest = picked; distance = d; }
  }
  return nearest || exact;
}

/** Capture once per follow session, in world coordinates, across aircraft switches. */
export function rememberAircraftView(viewer, stop) {
  if (viewer && stop) activeStops.set(viewer, stop);
  const camera = viewer?.camera;
  if (!camera || returnViews.has(viewer) || !camera.positionWC || !camera.directionWC || !camera.upWC) return;
  returnViews.set(viewer, {
    destination: Cesium.Cartesian3.clone(camera.positionWC),
    orientation: {
      direction: Cesium.Cartesian3.clone(camera.directionWC),
      up: Cesium.Cartesian3.clone(camera.upWC),
    },
  });
}

/** A different kind of tracked object owns its own camera lifecycle. */
export function forgetAircraftView(viewer) {
  if (!viewer) return;
  returnViews.delete(viewer);
  activeStops.delete(viewer);
}

export function restoreAircraftView(viewer) {
  const view = viewer && returnViews.get(viewer);
  if (!view) { if (viewer) activeStops.delete(viewer); return false; }
  returnViews.delete(viewer);
  activeStops.delete(viewer);
  viewer.camera.cancelFlight?.();
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.camera.setView(view);
  viewer.scene.requestRender?.();
  return true;
}

export function closeAircraftDetails(viewer, layerId, { preserveContext = false } = {}) {
  const state = viewer && details.get(viewer);
  if (!state || (layerId && state.layerId !== layerId)) return;
  clearInterval(state.timer);
  const hadFocus = state.panel.contains?.(document.activeElement);
  state.panel.remove();
  if (hadFocus) viewer.scene.canvas?.focus?.({ preventScroll: true });
  details.delete(viewer);
  if (!preserveContext) clearSelectedEntityContextForLayer(state.layerId);
}

/** A details selection never moves the camera. Only the explicit Track action follows. */
export function showAircraftDetails(viewer, { id, layerId, read, track, stop, isTracking }) {
  if (typeof document === 'undefined' || !document.createElement) return;
  closeAircraftDetails(viewer);
  const metadata = read(id);
  if (!metadata) return;
  const context = selectTrackedSubjectContext(metadata);
  if (context) selectEntityContext(context.entity);
  const panel = document.createElement('section');
  panel.className = 'aircraft-details';
  panel.setAttribute('aria-label', 'Aircraft details');
  const heading = document.createElement('h2');
  const source = document.createElement('p');
  const fields = document.createElement('dl');
  const actions = document.createElement('div');
  actions.className = 'aircraft-details-actions';
  const trackButton = document.createElement('button');
  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.setAttribute('aria-label', 'Close aircraft details and return to previous view');
  actions.append(trackButton, closeButton);
  panel.append(heading, source, fields, actions);
  const render = () => {
    const current = read(id);
    heading.textContent = current?.label || metadata.label;
    source.textContent = current ? `${current.source} · ${current.properties?.status || 'live'}` : 'No longer in the current feed';
    trackButton.textContent = isTracking(id) ? 'Stop tracking' : 'Track';
    trackButton.disabled = !current;
    if (!current) return;
    fields.replaceChildren();
    for (const [key, label] of [['callsign','Callsign'], ['registration','Registration'], ['operator','Operator'], ['type','Aircraft'], ['altitude','Altitude'], ['speed','Speed'], ['heading','Heading'], ['origin','Origin'], ['destination','Destination'], ['route','Route'], ['icao24','ICAO']]) {
      if (key === 'route' && (current.properties?.origin || current.properties?.destination)) continue;
      const value = current.properties?.[key];
      if (!value) continue;
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = value;
      fields.append(term, description);
    }
  };
  trackButton.addEventListener('click', () => {
    if (isTracking(id)) { (activeStops.get(viewer) || stop)(); closeAircraftDetails(viewer); }
    else {
      track(id);
      if (isTracking(id)) closeAircraftDetails(viewer, layerId, { preserveContext: true });
      else render();
    }
  });
  closeButton.addEventListener('click', () => { (activeStops.get(viewer) || stop)(); closeAircraftDetails(viewer); });
  document.body.append(panel);
  details.set(viewer, { layerId, panel, timer: setInterval(render, 2000) });
  render();
  trackButton.focus?.({ preventScroll: true });
}
