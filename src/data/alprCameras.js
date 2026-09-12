import * as Cesium from 'cesium';
import { alprBoxes, alprQuery, normalizeAlpr } from './alprData.js';
import { registerPickOwner, unregisterPickOwner, resolvePickId } from './pickRegistry.js';
import { bindTrackingClickGesture, isTrackingClickGesture } from './trackingClickGesture.js';
import { registerEntityContext, selectEntityContext, removeEntityContextsForLayer, clearSelectedEntityContextForLayer } from './contextStore.js';

const ID = 'alpr-cameras';
const COLOR = Cesium.Color.fromCssColorString('#f29ccc');
const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="5" width="28" height="22" rx="6" fill="#241326" stroke="#f29ccc" stroke-width="2"/><rect x="7" y="11" width="18" height="10" rx="2" fill="none" stroke="#f29ccc" stroke-width="2"/><path d="M10 16h3m3 0h6" stroke="#fff" stroke-width="2"/></svg>');

export function createAlprLayer({ fetchData = (...args) => fetch(...args), installInput = true } = {}) {
  let viewer, source, handler, removeMove, removeStart, timer, abort, panel, selected;
  let enabled = false, epoch = 0, loadedKey = '', pendingKey = '', records = new Map();
  let stats = { count: 0, status: 'idle', loading: false, lastUpdate: null, stale: false, error: null };
  const cache = new Map();
  const render = () => viewer?.scene.requestRender?.();
  const close = () => {
    if (selected) { const entity=source?.entities.getById(selected); if (entity?.billboard) entity.billboard.scale=1; }
    panel?.remove(); panel = null; selected = null;
    source?.entities.removeById('alpr-direction');
    if (typeof window !== 'undefined') clearSelectedEntityContextForLayer(ID);
    render();
  };
  function inspect(id) {
    const record = records.get(id); if (!record) return;
    close(); selected = id;
    source.entities.getById(id).billboard.scale=1.2;
    selectEntityContext(source.entities.getById(id));
    panel = document.createElement('section'); panel.className = 'alpr-details'; panel.setAttribute('aria-label','ALPR camera details');
    const title = document.createElement('h2'); title.textContent = record.name;
    const note = document.createElement('p'); note.textContent = `${stats.stale ? 'Stale source snapshot · ' : ''}Crowdsourced mapping · operating status unknown`;
    const list = document.createElement('dl');
    for (const [label,value] of [['Manufacturer',record.manufacturer],['Model',record.model],['Camera type',record.cameraType],['Operator',record.operator],['Mount',record.mount],['Watches',record.zone],['Mapped direction',record.direction === null ? 'Not mapped' : `${record.direction}°`],['Coordinates',`${record.lat.toFixed(6)}, ${record.lon.toFixed(6)}`],['OSM last edit',record.editedAt],['Mapped check date',record.checkedAt],['Data snapshot',stats.snapshotAt],['Loaded',new Date(stats.lastUpdate).toISOString()]]) {
      if (!value) continue;
      const term=document.createElement('dt'); term.textContent=label;
      const valueNode=document.createElement('dd'); valueNode.textContent=value; list.append(term,valueNode);
    }
    const links=document.createElement('p');
    for (const [label,url] of [['OpenStreetMap record',record.osmUrl],['DeFlock map','https://deflock.org/map']]) {
      const a=document.createElement('a'); a.textContent=label; a.href=url; a.target='_blank'; a.rel='noopener noreferrer'; links.append(a,document.createTextNode(' '));
    }
    const attribution=document.createElement('p'); attribution.textContent='Map data © OpenStreetMap contributors · ODbL';
    const license=document.createElement('a'); license.href='https://www.openstreetmap.org/copyright'; license.textContent='Data license'; license.target='_blank'; license.rel='noopener noreferrer'; attribution.append(' ',license);
    const button=document.createElement('button'); button.textContent='Close'; button.addEventListener('click',close);
    const bearingNote=document.createElement('p'); bearingNote.textContent='Direction arrows show mapped bearing only; camera range is unknown.';
    panel.append(title,note,list,bearingNote,links,attribution,button); document.body.append(panel); button.focus({preventScroll:true});
    if (record.direction !== null) {
      // This short pointer represents bearing only, never a claimed detection range.
      const pointerM=Math.min(1500,Math.max(40,(viewer.camera.positionCartographic?.height || 8000)*0.035));
      const heading=Cesium.Math.toRadians(record.direction), angular=pointerM/6371008.8;
      const lat=Cesium.Math.toRadians(record.lat), lon=Cesium.Math.toRadians(record.lon);
      const endLat=Math.asin(Math.sin(lat)*Math.cos(angular)+Math.cos(lat)*Math.sin(angular)*Math.cos(heading));
      const endLon=lon+Math.atan2(Math.sin(heading)*Math.sin(angular)*Math.cos(lat),Math.cos(angular)-Math.sin(lat)*Math.sin(endLat));
      source.entities.add({id:'alpr-direction',polyline:{positions:Cesium.Cartesian3.fromDegreesArray([record.lon,record.lat,Cesium.Math.toDegrees(endLon),Cesium.Math.toDegrees(endLat)]),width:8,clampToGround:true,material:new Cesium.PolylineArrowMaterialProperty(COLOR)}});
    }
    render();
  }
  function commit(data) {
    const prior=selected; close();
    source.entities.removeAll(); removeEntityContextsForLayer(ID); records=new Map();
    for (const record of data.records) {
      records.set(record.id,record);
      const entity=source.entities.add({id:record.id,position:Cesium.Cartesian3.fromDegrees(record.lon,record.lat),billboard:{image:ICON,width:24,height:24,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,disableDepthTestDistance:100000}});
      registerEntityContext(entity,{id:record.id,layerId:ID,layerName:'ALPR Cameras',source:'OpenStreetMap / DeFlock community',label:record.name,latitude:record.lat,longitude:record.lon,dataSource:source,properties:{manufacturer:record.manufacturer,operator:record.operator,status:'Mapped location; operating status unknown',osmUrl:record.osmUrl}});
    }
    if (prior && records.has(prior)) inspect(prior);
    render();
  }
  function cancel() { epoch++; abort?.abort(); abort=null; pendingKey=''; clearTimeout(timer); stats.loading=false; }
  async function load() {
    if (!enabled) return;
    let rectangle; try { rectangle=viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid); } catch { /* sky view */ }
    const boxes=rectangle ? alprBoxes([rectangle.west,rectangle.south,rectangle.east,rectangle.north].map(Cesium.Math.toDegrees)) : [];
    if (!boxes.length) { cancel(); stats.status='zoom-in'; stats.error=null; stats.statusMessage='Zoom in to load mapped ALPR cameras'; render(); return; }
    const key=alprQuery(boxes);
    if (abort && pendingKey===key) return;
    if (loadedKey===key && Date.now()-stats.lastUpdate<86400000 && !stats.error && !stats.stale) return;
    cancel(); const requestEpoch=epoch; const controller=new AbortController(); abort=controller; pendingKey=key;
    stats={...stats,loading:true,status:'loading',error:null,statusMessage:'Loading mapped ALPR cameras'}; render();
    const timeout=setTimeout(()=>controller.abort(),100000);
    try {
      let data=cache.get(key);
      if (!data || Date.now()-data.loadedAt>86400000) {
        const response=await fetchData('/api/overpass',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:key}).toString(),signal:controller.signal});
        if (!response.ok) throw new Error(`Mapping provider unavailable (HTTP ${response.status})`);
        const normalized=normalizeAlpr(await response.json());
        const snapshotTime=Date.parse(normalized.snapshotAt);
        data={...normalized,loadedAt:Date.now(),stale:response.headers.get('X-Overpass-Cache')==='STALE' || (Number.isFinite(snapshotTime) && Date.now()-snapshotTime>7*86400000)};
        if (requestEpoch!==epoch || !enabled) return;
        if (!data.stale) { cache.delete(key); cache.set(key,data); while(cache.size>16) cache.delete(cache.keys().next().value); }
      }
      if (requestEpoch!==epoch || !enabled) return;
      stats={...stats,count:data.records.length,lastUpdate:data.loadedAt,snapshotAt:data.snapshotAt,stale:data.stale,loading:false,status:data.records.length?'mapped':'empty',truncated:data.truncated,statusMessage:data.truncated?'Showing first 2,000 mapped cameras; zoom in for detail':data.records.length?'Crowdsourced mapped locations · operating status unknown':'No ALPR cameras mapped in this region; coverage may be incomplete'};
      const unchanged=loadedKey===key && JSON.stringify([...records.values()])===JSON.stringify(data.records);
      loadedKey=key;
      if (!unchanged) commit(data);
      else render();
    } catch(error) {
      if (requestEpoch!==epoch || !enabled) return;
      stats={...stats,loading:false,status:records.size?'stale':'unavailable',stale:records.size>0,error:controller.signal.aborted?'ALPR mapping request timed out':error.message,statusMessage:'Mapping unavailable; retrying in one minute'}; render();
    } finally { clearTimeout(timeout); if (requestEpoch===epoch) {stats.loading=false; abort=null; pendingKey='';} }
  }
  function schedule() { clearTimeout(timer); if (enabled) timer=setTimeout(load,750); }
  function keydown(event) { if (event.key==='Escape') close(); }
  return {
    id:ID,name:'ALPR Cameras',icon:'▤',source:'OpenStreetMap · DeFlock community',updateInterval:60000,statsRefreshInterval:1000,
    init(v) {
      viewer=v; source=new Cesium.CustomDataSource(ID); viewer.dataSources.add(source); source.show=false;
      removeMove=viewer.camera.moveEnd.addEventListener(schedule); removeStart=viewer.camera.moveStart.addEventListener(cancel);
      if (installInput) {
        handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        bindTrackingClickGesture(handler,(click,gesture)=>{
          if (!enabled || !isTrackingClickGesture(gesture) || document.body.classList.contains('cockpit-mode')) return;
          const picked=viewer.scene.pick(click.position,32,32), id=resolvePickId(picked);
          if (records.has(id)) inspect(id); else if (id!=='alpr-direction') close();
        });
        document.addEventListener('keydown',keydown);
      }
    },
    enable() {enabled=true;source.show=true;registerPickOwner(ID,id=>records.has(id)||id==='alpr-direction');},
    disable() {enabled=false;cancel();close();source.show=false;unregisterPickOwner(ID);stats.status='idle';},
    update:load,
    destroy(v) {this.disable();removeMove?.();removeStart?.();handler?.destroy();if(installInput) document.removeEventListener('keydown',keydown);removeEntityContextsForLayer(ID);v.dataSources.remove(source,true);cache.clear();records.clear();viewer=null;},
    getStats() {return {...stats};},
  };
}
export default createAlprLayer();
