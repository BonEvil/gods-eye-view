import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {_inspectFlight, _setTrackedFlightRefreshStateForTest} from './flights.js';
import {closeAircraftDetails} from './aircraftSelection.js';

function element(tag) {
  return {tag, children: [], append(...nodes) {this.children.push(...nodes);},
    replaceChildren(...nodes) {this.children=nodes;}, setAttribute() {},
    addEventListener() {}, remove() {this.removed=true;}};
}

test('clicking an untracked flight loads airport details, refreshes the panel, and deduplicates repeat inspection', async () => {
  const saved={document:globalThis.document,window:globalThis.window,CustomEvent:globalThis.CustomEvent,fetch:globalThis.fetch,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
  let render, complete, requests=0;
  globalThis.document={body:element('body'),createElement:element};
  globalThis.window={dispatchEvent(){}};
  globalThis.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options.detail;}};
  globalThis.setInterval=fn=>{render=fn;return 1;}; globalThis.clearInterval=()=>{};
  globalThis.fetch=url=>{requests++;assert.equal(url,'/api/adsbdb/route/DAL2707');return new Promise(resolve=>{complete=resolve;});};
  const viewer={camera:{},scene:{requestRender(){}}};
  const meta={callsign:'DAL2707',rawLat:33.75,rawLon:-84.39,altitude:5000,velocity:200,true_track:90,verticalRate:0};
  _setTrackedFlightRefreshStateForTest({icao24:'abc123',viewer,tracked:false,meta,
    billboard:{position:Cesium.Cartesian3.fromDegrees(-84.39,33.75,5000)},billboardCollection:{show:true}});
  const fields=()=>document.body.children.at(-1).children[2].children.map(node=>node.textContent);
  try {
    _inspectFlight('abc123');
    assert.equal(requests,1);
    assert.equal(document.body.children.at(-1).children[3].children[0].textContent,'Track');
    assert.ok(!fields().includes('Origin'));
    complete({ok:true,json:async()=>({found:true,origin:{code:'LGA',name:'New York',lat:40.77,lon:-73.87},destination:{code:'ATL',name:'Atlanta',lat:33.64,lon:-84.43}})});
    await new Promise(resolve=>setImmediate(resolve));
    render();
    assert.ok(fields().includes('LGA · New York'));
    assert.ok(fields().includes('ATL · Atlanta'));
    assert.ok(fields().includes('Origin')); assert.ok(fields().includes('Destination'));
    assert.ok(!fields().includes('Route'),'do not duplicate airport fields');
    _inspectFlight('abc123'); assert.equal(requests,1);
    // A mismatched scheduled leg must remain hidden even in the new fields.
    meta.route={origin:{code:'SYD',lat:-33.95,lon:151.18},destination:{code:'MEL',lat:-37.67,lon:144.84}};
    render(); assert.ok(!fields().includes('Origin')); assert.ok(!fields().includes('Destination'));
  } finally {
    closeAircraftDetails(viewer);
    Object.assign(globalThis,saved);
  }
});
