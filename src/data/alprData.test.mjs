import test from 'node:test';
import assert from 'node:assert/strict';
import {alprDirection,alprBoxes,alprQuery,normalizeAlpr,ALPR_LIMIT} from './alprData.js';
const camera = (id, extra={}) => ({type:'node',id,lat:33.75,lon:-84.39,tags:{man_made:'surveillance','surveillance:type':'ALPR',manufacturer:'Flock Safety',direction:'SW'},...extra});

test('ALPR tags distinguish plate readers, deduplicate OSM identity, and retain provenance',()=>{
  const data=normalizeAlpr({elements:[camera(1),camera(1),camera(2,{tags:{man_made:'surveillance'}}),camera(3,{lat:NaN}),camera(4,{type:'way',lat:undefined,lon:undefined,center:{lat:33,lon:-84}})],osm3s:{timestamp_osm_base:'2026-09-11T00:00:00Z'}});
  assert.equal(data.records.length,2); assert.equal(data.records[0].direction,225);
  assert.equal(data.records[1].osmUrl,'https://www.openstreetmap.org/way/4');
  assert.equal(data.snapshotAt,'2026-09-11T00:00:00Z');
  assert.throws(()=>normalizeAlpr({elements:[],remark:'timeout'}));
  assert.equal(normalizeAlpr({elements:[]}).records.length,0);
});

test('missing or ambiguous direction never becomes a made-up north bearing',()=>{
  for(const value of [undefined,'','north-ish','90;270','-1','361']) assert.equal(alprDirection(value),null);
  assert.equal(alprDirection('NNE'),22.5); assert.equal(alprDirection('360'),0); assert.equal(alprDirection('90°'),90);
});

test('local snapped queries split at the dateline and never issue a global request',()=>{
  assert.deepEqual(alprBoxes([-180,-80,180,80]),[]);
  assert.deepEqual(alprBoxes([179.9,10,-179.9,11]),[[179.75,10,180,11],[-180,10,-179.75,11]]);
  const query=alprQuery(alprBoxes([-84.45,33.65,-84.3,33.85]));
  assert.match(query,/\(33.5,-84.5,34,-84.25\)/); assert.match(query,/out meta center 2001/);
  assert.throws(()=>alprQuery([]));
});

test('dense responses expose truncation instead of presenting the cap as full coverage',()=>{
  const data=normalizeAlpr({elements:Array.from({length:ALPR_LIMIT+1},(_,i)=>camera(i+1))});
  assert.equal(data.records.length,ALPR_LIMIT); assert.equal(data.truncated,true);
});
