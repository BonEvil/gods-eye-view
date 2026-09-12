import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateSourceBudget, describeSourceMix, LIVE_PACK_KINDS } from './cctvSourceBudget.js';

const pack = (kind, n, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i + offset}`, sourceKind: kind }));

const countBy = (list) => {
  const m = {};
  for (const s of list) m[s.sourceKind] = (m[s.sourceKind] || 0) + 1;
  return m;
};

test('an under-cap catalog is returned untouched', () => {
  const list = [...pack('austin-open-data', 10), ...pack('gdot-511', 10)];
  assert.equal(allocateSourceBudget(list, 900), list);
});

test('the real starvation case: the last-merged pack keeps its fair share', () => {
  // Exactly the production shape that exposed the bug: 1050 sources, cap 900.
  const list = [
    ...pack('austin-open-data', 250),
    ...pack('caltrans-open-data', 300),
    ...pack('tfl-open-data', 250),
    ...pack('gdot-511', 250),
  ];
  const out = allocateSourceBudget(list, 900);
  assert.equal(out.length, 900);
  const counts = countBy(out);
  // Under the old slice(0, 900), gdot-511 would be 100. Every pack should now
  // give up a comparable share instead of one absorbing the entire shortfall.
  assert.ok(counts['gdot-511'] >= 200, `gdot starved: ${counts['gdot-511']}`);
  for (const kind of ['austin-open-data', 'tfl-open-data', 'gdot-511']) {
    assert.ok(counts[kind] >= 200 && counts[kind] <= 250, `${kind}=${counts[kind]}`);
  }
});

test('each pack keeps its own nearest-first ordering', () => {
  const list = [...pack('austin-open-data', 5), ...pack('gdot-511', 5)];
  const out = allocateSourceBudget(list, 6);
  const gdot = out.filter((s) => s.sourceKind === 'gdot-511').map((s) => s.id);
  // Whatever survives must be a prefix of the pack - never a later slice.
  assert.deepEqual(gdot, gdot.slice().sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop())));
  assert.equal(gdot[0], 'gdot-511-0');
});

test('operator-configured sources are seated before bulk discovery', () => {
  const list = [...pack('austin-open-data', 100), ...pack('configured', 5), ...pack('gdot-511', 100)];
  const out = allocateSourceBudget(list, 20);
  assert.equal(out.length, 20);
  assert.equal(countBy(out).configured, 5, 'explicit config must survive the cut');
});

test('configured sources alone exceeding the cap are truncated, not multiplied', () => {
  const out = allocateSourceBudget(pack('configured', 50), 10);
  assert.equal(out.length, 10);
  assert.equal(countBy(out).configured, 10);
});

test('an exhausted pack yields its budget to the others rather than short-filling', () => {
  const list = [...pack('austin-open-data', 2), ...pack('gdot-511', 100)];
  const out = allocateSourceBudget(list, 50);
  assert.equal(out.length, 50, 'must still fill the cap');
  assert.equal(countBy(out)['austin-open-data'], 2);
  assert.equal(countBy(out)['gdot-511'], 48);
});

test('degenerate caps do not throw or over-return', () => {
  const list = pack('gdot-511', 10);
  assert.deepEqual(allocateSourceBudget(list, 0), []);
  assert.deepEqual(allocateSourceBudget(list, -5), []);
  assert.deepEqual(allocateSourceBudget(list, NaN), []);
  assert.deepEqual(allocateSourceBudget(null, 10), []);
  assert.equal(allocateSourceBudget(list, 1).length, 1);
});

test('every loader kind in the codebase is covered by the round-robin set', () => {
  // A new pack that forgets to register here silently becomes unshareable.
  for (const kind of ['austin-open-data', 'caltrans-open-data', 'tfl-open-data', 'gdot-511']) {
    assert.ok(LIVE_PACK_KINDS.includes(kind), `${kind} missing from LIVE_PACK_KINDS`);
  }
});

test('the mix summary reports what actually survived', () => {
  const out = allocateSourceBudget([...pack('gdot-511', 3), ...pack('austin-open-data', 1)], 4);
  assert.equal(describeSourceMix(out), 'gdot-511=3, austin-open-data=1');
  assert.equal(describeSourceMix([]), '');
});
