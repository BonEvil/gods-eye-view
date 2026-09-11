import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { pickAircraft, rememberAircraftView, restoreAircraftView, forgetAircraftView, showAircraftDetails, closeAircraftDetails, AIRCRAFT_PICK_SIZE_PX } from './aircraftSelection.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';

function cameraFixture() {
  const calls = [];
  const viewer = {
    camera: {
      positionWC: new Cesium.Cartesian3(10, 20, 30),
      directionWC: new Cesium.Cartesian3(0, 0, -1),
      upWC: new Cesium.Cartesian3(0, 1, 0),
      cancelFlight() { calls.push('cancel'); },
      lookAtTransform(value) { calls.push(value); },
      setView(value) { calls.push(value); },
    },
    scene: { requestRender() { calls.push('render'); } },
  };
  return { viewer, calls };
}

test('leaving a follow session restores the original world pose after switching aircraft', () => {
  const { viewer, calls } = cameraFixture();
  rememberAircraftView(viewer);
  viewer.camera.positionWC.x = 900;
  viewer.camera.directionWC.z = 1;
  rememberAircraftView(viewer);
  assert.equal(restoreAircraftView(viewer), true);
  assert.deepEqual(calls[2].destination, new Cesium.Cartesian3(10, 20, 30));
  assert.deepEqual(calls[2].orientation.direction, new Cesium.Cartesian3(0, 0, -1));
  assert.deepEqual(calls[2].orientation.up, new Cesium.Cartesian3(0, 1, 0));
  assert.equal(calls[1], Cesium.Matrix4.IDENTITY);
  assert.equal(restoreAircraftView(viewer), false, 'a later deselect cannot replay an old view');
  rememberAircraftView(viewer);
  restoreAircraftView(viewer);
  assert.equal(calls[6].destination.x, 900, 'a new session captures a new origin');
});

test('near misses use a 44px aperture for aircraft, while an exact sibling pick wins', () => {
  registerPickOwner('flights', id => id === 'plane');
  registerPickOwner('cctv', id => id === 'camera');
  try {
    const aircraft = { id: 'plane' };
    const scene = { pick: () => undefined, drillPick: (...args) => {
      assert.equal(args[2], AIRCRAFT_PICK_SIZE_PX);
      assert.equal(args[3], 44);
      return [{ id: 'building' }, aircraft];
    } };
    assert.equal(pickAircraft(scene, { x: 1, y: 2 }), aircraft);
    scene.pick = () => ({ id: 'camera' });
    scene.drillPick = () => { throw new Error('exact pick must win'); };
    assert.equal(pickAircraft(scene, { x: 1, y: 2 }).id, 'camera');
  } finally { unregisterPickOwner('flights'); unregisterPickOwner('cctv'); }
});

function element(tag) {
  return { tag, children: [], listeners: {}, attrs: {}, removed: false,
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    remove() { this.removed = true; },
  };
}

test('inspection shows details without following; Track follows and Close exits the active aircraft', () => {
  const old = { document: globalThis.document, window: globalThis.window, CustomEvent: globalThis.CustomEvent };
  globalThis.document = { body: element('body'), createElement: element };
  globalThis.window = { dispatchEvent() {} };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  const { viewer, calls } = cameraFixture();
  let tracking = false;
  let tracks = 0;
  let stops = 0;
  const stop = () => { stops++; tracking = false; restoreAircraftView(viewer); };
  try {
    const options = { id: 'a', layerId: 'flights', read: id => ({id, layerId: 'flights', label:'Flight A', source:'Fixture', properties:{altitude:'30,000 ft', speed:'420 kt'}}),
      track() { tracks++; tracking = true; rememberAircraftView(viewer, stop); }, stop,
      isTracking() { return tracking; } };
    showAircraftDetails(viewer, options);
    let panel = document.body.children.at(-1);
    assert.equal(panel.children[0].textContent, 'Flight A');
    assert.equal(tracks, 0);
    assert.equal(calls.length, 0);
    panel.children[3].children[0].listeners.click();
    assert.equal(tracks, 1);
    assert.equal(panel.children[3].children[0].textContent, 'Stop tracking');
    // Inspect another layer while A is still followed; Close must release A.
    showAircraftDetails(viewer, {...options, id:'b', layerId:'military', stop() { throw new Error('wrong tracker'); }, isTracking: () => false});
    assert.equal(panel.removed, true);
    panel = document.body.children.at(-1);
    panel.children[3].children[1].listeners.click();
    assert.equal(stops, 1);
    assert.equal(panel.removed, true);
    assert.equal(calls[2].destination.x, 10);
  } finally {
    closeAircraftDetails(viewer);
    Object.assign(globalThis, old);
  }
});


test('handoff to a non-aircraft tracker discards the aircraft return view without moving the camera', () => {
  const { viewer, calls } = cameraFixture();
  rememberAircraftView(viewer);
  forgetAircraftView(viewer);
  assert.equal(restoreAircraftView(viewer), false);
  assert.equal(calls.length, 0);
});
