import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {createAlprLayer} from './alprCameras.js';
function fixture() {
  globalThis.window={dispatchEvent(){}};
  const viewer={camera:{moveEnd:new Cesium.Event(),moveStart:new Cesium.Event(),computeViewRectangle:()=>Cesium.Rectangle.fromDegrees(-84.45,33.65,-84.3,33.85)},scene:{globe:{ellipsoid:Cesium.Ellipsoid.WGS84},requestRender(){}},dataSources:{add(){},remove(){}}};
  return viewer;
}
const payload={elements:[{type:'node',id:1,lat:33.75,lon:-84.39,tags:{man_made:'surveillance','surveillance:type':'ALPR'}}]};
const response=(data=payload)=>({ok:true,headers:{get:()=>null},json:async()=>data});
test('same snapped view reuses data and disable prevents an in-flight response from repopulating',async()=>{
  const old=globalThis.window; const viewer=fixture(); let calls=0, finish;
  const layer=createAlprLayer({installInput:false,fetchData:async()=>{calls++;return response();}});
  try {
    layer.init(viewer);layer.enable();await layer.update();await layer.update();
    assert.equal(calls,1);assert.equal(layer.getStats().count,1);
    layer.destroy(viewer);
    const pending=createAlprLayer({installInput:false,fetchData:()=>new Promise(resolve=>{finish=resolve;})});
    pending.init(viewer);pending.enable();const update=pending.update();pending.disable();finish(response());await update;
    assert.equal(pending.getStats().count,0);assert.equal(pending.getStats().loading,false);pending.destroy(viewer);
  } finally {globalThis.window=old;}
});
test('empty mapping and an unavailable provider have distinct states',async()=>{
  const old=globalThis.window; const viewer=fixture();
  for(const [fetchData,expected] of [[async()=>response({elements:[]}), 'empty'],[async()=>{throw Error('offline');},'unavailable']]) {
    const layer=createAlprLayer({installInput:false,fetchData});
    try {layer.init(viewer);layer.enable();await layer.update();assert.equal(layer.getStats().status,expected);} finally {layer.destroy(viewer);}
  }
  globalThis.window=old;
});

test('an old OSM snapshot is marked stale and concurrent identical refreshes coalesce',async()=>{
  const old=globalThis.window; const viewer=fixture();let resolve, calls=0;
  const layer=createAlprLayer({installInput:false,fetchData:()=>{calls++;return new Promise(done=>{resolve=done;});}});
  try {
    layer.init(viewer);layer.enable();const first=layer.update();await layer.update();assert.equal(calls,1);
    resolve(response({...payload,osm3s:{timestamp_osm_base:'2020-01-01T00:00:00Z'}}));await first;
    assert.equal(layer.getStats().stale,true);assert.equal(layer.getStats().snapshotAt,'2020-01-01T00:00:00Z');
  } finally {layer.destroy(viewer);globalThis.window=old;}
});
