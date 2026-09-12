import test from 'node:test';
import assert from 'node:assert/strict';
import { directionToHeading } from './directionText.js';
import {
  parseWktPoint,
  isLikelyGeorgiaCoordinate,
  pickGdotImage,
  gdotLabel,
  gdotCameraFromRecord,
} from './gdotCameras.js';

/** A real ATL record shape, trimmed to the fields the parser reads. */
const ATL_RECORD = Object.freeze({
  id: 11141,
  visible: true,
  location: 'ATL-0602: SR 13 at Lenox Rd / Cheshire Bridge Rd (Atlanta)',
  roadway: 'SR 13',
  direction: 'Northbound',
  latLng: { geography: { coordinateSystemId: 4326, wellKnownText: 'POINT (-84.3528 33.8258)' } },
  images: [{ id: 18558, imageUrl: '/map/Cctv/18558', description: 'ATL-0602', disabled: false, blocked: false }],
});

const build = (record) => gdotCameraFromRecord(record, {
  headingFrom: directionToHeading,
  fallbackHeading: () => 42,
});

test('WKT is longitude-first - reading it positionally would transpose the globe', () => {
  assert.deepEqual(parseWktPoint('POINT (-84.91445 34.37697)'), { lat: 34.37697, lon: -84.91445 });
});

test('malformed WKT yields null instead of throwing mid-catalog', () => {
  for (const bad of ['', 'garbage', 'POINT()', 'POINT (a b)', null, undefined, 'LINESTRING (1 2, 3 4)']) {
    assert.equal(parseWktPoint(bad), null);
  }
});

test('a transposed coordinate is rejected as outside Georgia', () => {
  // The most likely parse bug: lat/lon swapped puts the camera in the Pacific.
  assert.equal(isLikelyGeorgiaCoordinate(33.8258, -84.3528), true);
  assert.equal(isLikelyGeorgiaCoordinate(-84.3528, 33.8258), false);
});

test('disabled and blocked images are skipped, not turned into dead cameras', () => {
  const rec = {
    images: [
      { id: 1, imageUrl: '/map/Cctv/1', disabled: true },
      { id: 2, imageUrl: '/map/Cctv/2', blocked: true },
      { id: 3, imageUrl: '/map/Cctv/3' },
    ],
  };
  assert.equal(pickGdotImage(rec).id, 3);
  assert.equal(pickGdotImage({ images: [{ id: 1, imageUrl: '', disabled: false }] }), null);
  assert.equal(pickGdotImage({}), null);
});

test('the duplicated camera code is stripped from the label', () => {
  assert.equal(gdotLabel('ATL-0602: SR 13 at Lenox Rd (Atlanta)'), 'SR 13 at Lenox Rd (Atlanta)');
  assert.equal(gdotLabel('BART-0209: SR 140 at Princeton Blvd (BARTOW)'), 'SR 140 at Princeton Blvd (BARTOW)');
  assert.equal(gdotLabel('No code here'), 'No code here');
});

test('a real Atlanta record becomes a complete image source', () => {
  const cam = build(ATL_RECORD);
  assert.equal(cam.id, 'ga-gdot-11141-18558');
  assert.equal(cam.lat, 33.8258);
  assert.equal(cam.lon, -84.3528);
  assert.equal(cam.feedType, 'image');
  assert.equal(cam.url, 'https://511ga.org/map/Cctv/18558');
  assert.equal(cam.provider, 'Georgia DOT 511');
  assert.equal(cam.cityId, 'atlanta');
  // "Northbound" is a dedicated direction field, so it must resolve, not fall back.
  assert.equal(cam.headingDeg, 0);
  assert.equal(cam.headingConfidence, 'high');
});

test('relative image paths are absolutized against the 511 origin', () => {
  assert.equal(build(ATL_RECORD).url, 'https://511ga.org/map/Cctv/18558');
  const absolute = { ...ATL_RECORD, images: [{ id: 9, imageUrl: 'https://cdn.example.com/x.png' }] };
  assert.equal(build(absolute).url, 'https://cdn.example.com/x.png');
});

test('a missing direction degrades to the low-confidence pose, not a wrong-confidence one', () => {
  const cam = build({ ...ATL_RECORD, direction: null });
  assert.equal(cam.headingDeg, 42);
  assert.equal(cam.headingConfidence, 'low');
  // The fabricated pose must widen when the heading is a guess.
  assert.equal(cam.fovDeg, 44);
  assert.equal(cam.pitchDeg, -18);
});

test('unusable records return null rather than a half-built camera', () => {
  assert.equal(build({ ...ATL_RECORD, visible: false }), null);
  assert.equal(build({ ...ATL_RECORD, latLng: null }), null);
  assert.equal(build({ ...ATL_RECORD, images: [] }), null);
  assert.equal(build({ ...ATL_RECORD, id: null, DT_RowId: null }), null);
  // Out-of-state coordinate (Los Angeles) must not survive.
  assert.equal(build({ ...ATL_RECORD, latLng: { geography: { wellKnownText: 'POINT (-118.24 34.05)' } } }), null);
  assert.equal(build(null), null);
});

test('camera ids are unique per image, so a multi-image site does not collide', () => {
  const two = {
    ...ATL_RECORD,
    images: [{ id: 111, imageUrl: '/map/Cctv/111' }, { id: 222, imageUrl: '/map/Cctv/222' }],
  };
  assert.equal(build(two).id, 'ga-gdot-11141-111');
  assert.notEqual(build(two).id, build({ ...two, id: 99 }).id);
});
