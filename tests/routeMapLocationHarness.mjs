import { join, resolve } from 'node:path';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '..');
const realLeafletHarness = `
import L from './node_modules/leaflet/dist/leaflet-src.js';
const createMap = L.map;
const createTileLayer = L.tileLayer;
L.tileLayer = (_url, options) => createTileLayer('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', options);
L.map = (...args) => { const map = createMap(...args); window.__locationTest.maps.push(map); return map; };
export default L;
`;

// Keep the map observable without substituting the location behavior under test.
const leafletMock = `
const qa = window.__locationTest;
const coordinates = value => Array.isArray(value) ? { lat: value[0], lng: value[1] } : { lat: value.lat, lng: value.lng };
const handler = () => ({ enable() {}, disable() {} });
class MapMock {
  constructor(container) {
    this.container = container; this.events = new Map(); this.center = { lat: 0, lng: 0 }; this.zoom = 4;
    this.calls = []; this.markers = []; this.bearing = 0; this.removed = false;
    this.dragging = handler(); this.scrollWheelZoom = handler(); this.touchRotate = handler();
    qa.maps.push(this);
  }
  on(names, callback) { for (const name of names.split(' ')) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); } return this; }
  once(names, callback) { const wrapped = detail => { this.off(names, wrapped); callback(detail); }; return this.on(names, wrapped); }
  off(names, callback) { for (const name of names.split(' ')) this.events.get(name)?.delete(callback); return this; }
  fire(name, detail = {}) { for (const callback of [...(this.events.get(name) || [])]) callback(detail); return this; }
  setView(point, zoom, options = {}) { this.center = coordinates(point); this.zoom = zoom; this.calls.push({ method: 'setView', point: this.center, zoom, options }); this.fire('moveend'); return this; }
  flyTo(point, zoom, options = {}) { this.center = coordinates(point); this.zoom = zoom; this.calls.push({ method: 'flyTo', point: this.center, zoom, options }); this.fire('moveend'); return this; }
  panTo(point, options = {}) { return this.setView(point, this.zoom, options); }
  stop() { this.calls.push({ method: 'stop' }); return this; }
  getCenter() { return this.center; }
  getZoom() { return this.zoom; }
  setZoom(zoom) { this.zoom = zoom; return this; }
  getContainer() { return this.container; }
  getSize() { return { x: 390, y: 844 }; }
  getBearing() { return this.bearing; }
  setBearing(value) { this.bearing = value; this.fire('rotate'); return this; }
  invalidateSize() { return this; }
  distance(a, b) { const p = coordinates(a); const q = coordinates(b); return Math.hypot(p.lat - q.lat, p.lng - q.lng) * 111000; }
  removeLayer() { return this; }
  closePopup() { return this; }
  remove() { this.removed = true; this.events.clear(); return this; }
  fitBounds(bounds) { this.center = coordinates(bounds.points[0]); this.zoom = 13; this.calls.push({ method: 'fitBounds' }); return this; }
}
class MarkerMock {
  constructor(point, options) { this.point = coordinates(point); this.options = options; this.events = new Map(); }
  addTo(map) { this.map = map; map.markers.push(this); return this; }
  bindPopup(content) { this.popup = content; return this; }
  setPopupContent(content) { this.popup = content; return this; }
  setLatLng(point) { this.point = coordinates(point); return this; }
  getLatLng() { return this.point; }
  setIcon(icon) { this.icon = icon; return this; }
  on(event, callback) { this.events.set(event, callback); return this; }
  off(event) { this.events.delete(event); return this; }
  closePopup() { return this; }
  remove() { return this; }
}
const domEvent = {
  on(node, name, callback) { node.addEventListener(name, callback); return this; },
  stopPropagation(event) { event.stopPropagation(); },
  preventDefault(event) { event.preventDefault(); },
  disableClickPropagation() {}, disableScrollPropagation() {},
};
export default {
  map: container => new MapMock(container),
  latLng: (latitude, longitude) => typeof latitude === 'number' ? { lat: latitude, lng: longitude } : coordinates(latitude),
  marker: (point, options) => new MarkerMock(point, options),
  divIcon: value => value,
  latLngBounds: points => ({ points, extend(point) { this.points.push(point); return this; }, isValid() { return true; } }),
  tileLayer: () => ({ addTo() { return this; } }),
  Control: { extend: definition => class {
    addTo(map) { this.container = definition.onAdd.call(this, map); map.container.appendChild(this.container); return this; }
    getContainer() { return this.container; }
  } },
  DomUtil: { create(tag, className, parent) { const element = document.createElement(tag); element.className = className; parent?.appendChild(element); return element; } },
  DomEvent: domEvent,
};
`;
const app = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RouteMap from './src/components/RouteMap';
const qa = window.__locationTest;
const empty = [];
const sampleHomeBase = { id: 'qa-home', latitude: 39.7, longitude: -105, address: 'Synthetic home base' };
const sampleResult = { routes: [] };
const visibility = { hideAllCompleted: false, hideInternallyCompleted: false, hideValidPlans: false, hideExpiringPlans: false, hideExternallyCompleted: false };
function App() {
  const [epoch, setEpoch] = useState(0);
  const [, setRevision] = useState(0);
  qa.rerender = () => setRevision(value => value + 1);
  const [mounted, setMounted] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [navigation, setNavigation] = useState(false);
  const [fullscreen, setFullscreen] = useState(true);
  const [target, setTarget] = useState(null);
  qa.state = { tracking, navigation, fullscreen, target, mounted };
  qa.setTarget = setTarget;
  qa.setFullscreen = setFullscreen;
  qa.remount = () => { setTracking(false); setNavigation(false); setTarget(null); setFullscreen(true); setEpoch(value => value + 1); };
  qa.unmount = () => setMounted(false);
  const changeTracking = value => { qa.trackingChanges.push(value); setTracking(value); };
  return mounted ? <RouteMap key={epoch} result={qa.withMapData ? sampleResult : null} homeBase={qa.withMapData || qa.withHomeBase ? sampleHomeBase : null}
    facilities={qa.withMapData ? [...empty] : empty} inspections={empty} completedVisibility={visibility}
    isFullScreen={fullscreen} targetCoords={target}
    locationTracking={tracking} onLocationTrackingChange={changeTracking}
    navigationMode={navigation} onNavigationModeChange={setNavigation}
    onClearTargetCoords={() => { qa.targetClears++; setTarget(null); }}
    onExitFullscreen={() => { qa.exits++; setFullscreen(false); }}
    onUpdateRoute={() => qa.routeUpdates++}
    onNavigateToView={view => qa.views.push(view)}
  /> : null;
}
const root = createRoot(document.getElementById('root'));
qa.destroy = () => root.unmount();
root.render(<App />);
`;
export async function buildLocationHarness(output, { realLeaflet = false } = {}) {
await build({
  stdin: { contents: app, loader: 'jsx', resolveDir: root, sourcefile: 'location-test.jsx' },
  outfile: join(output, 'app.js'), bundle: true, format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'location-test-isolation', setup(plugin) {
    plugin.onResolve({ filter: /^leaflet(?:-rotate)?$/ }, args => realLeaflet && args.path === 'leaflet-rotate' ? undefined : ({ path: args.path, namespace: 'map-mock' }));
    plugin.onLoad({ filter: /.*/, namespace: 'map-mock' }, args => ({ contents: args.path === 'leaflet' ? (realLeaflet ? realLeafletHarness : leafletMock) : '', loader: 'js', resolveDir: root }));
    plugin.onResolve({ filter: /(?:lib\/supabase|services\/osrm|hooks\/useOnlineStatus)$/ }, args => ({ path: args.path, namespace: 'service-mock' }));
    plugin.onLoad({ filter: /.*/, namespace: 'service-mock' }, args => ({ contents:
      args.path.endsWith('useOnlineStatus') ? 'export const useOnlineStatus = () => ({ isOnline: false });'
      : args.path.endsWith('osrm') ? 'export const getRouteGeometry = async () => { throw new Error("Unexpected routing request"); };'
      : 'export const supabase = { from() { throw new Error("Unexpected database request"); } };', loader: 'js' }));
    plugin.onResolve({ filter: /^\.\/(?:ModalPortal|NavigationPopup|SearchInput|FacilityDetailModal|SPCCPlanDetailModal|FacilityInspectionsManager|SpeedDisplay)$/ }, args => ({ path: args.path, namespace: 'child-mock' }));
    plugin.onLoad({ filter: /.*/, namespace: 'child-mock' }, args => ({ contents: args.path.endsWith('ModalPortal') ? 'export default ({ children }) => children;' : 'export default () => null;', loader: 'js' }));
  }}],
});
}
