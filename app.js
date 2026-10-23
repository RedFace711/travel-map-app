'use strict';

/* ---------- Storage ---------- */

const STORE_KEY = 'travelmap.v1';
const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
const TOTAL_COUNTRIES = 195;
const COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#d97706', '#65a30d', '#0891b2', '#475569'];
const WISH_COLOR = '#d97706';

function emptyState() {
  return { countries: {}, cities: [], places: [], todos: [] };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    return Object.assign(emptyState(), JSON.parse(raw));
  } catch (e) {
    return emptyState();
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  renderAll();
}

if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const byName = (a, b) => a.name.localeCompare(b.name);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------- Data helpers ---------- */

const getCity = id => state.cities.find(c => c.id === id);
const getPlace = id => state.places.find(p => p.id === id);
const countryStatus = name => state.countries[name]?.status || null;

function countryColor(name) {
  const c = state.countries[name];
  if (c?.color) return c.color;
  // Stable default colour per country so the map looks varied.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function setCountry(name, status) {
  if (!name) return;
  if (!status) {
    delete state.countries[name];
  } else {
    state.countries[name] = Object.assign({}, state.countries[name], { status });
  }
}

function markCountryVisited(name) {
  if (name && countryStatus(name) !== 'visited') setCountry(name, 'visited');
}

function refKey(ref) { return ref ? `${ref.type}:${ref.id}` : ''; }
function parseRef(key) {
  if (!key) return null;
  const i = key.indexOf(':');
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}
function refLabel(ref) {
  if (!ref) return 'General';
  if (ref.type === 'country') return ref.id;
  if (ref.type === 'city') { const c = getCity(ref.id); return c ? `${c.name}, ${c.country || ''}`.replace(/, $/, '') : 'Deleted city'; }
  if (ref.type === 'place') { const p = getPlace(ref.id); return p ? p.name : 'Deleted place'; }
  return '';
}
function refIcon(ref) {
  return !ref ? '📝' : ref.type === 'country' ? '🏳️' : ref.type === 'city' ? '🏙️' : '📍';
}
const todosFor = ref => state.todos.filter(t => refKey(t.ref) === refKey(ref));

function deleteCity(id) {
  state.cities = state.cities.filter(c => c.id !== id);
  state.places.forEach(p => { if (p.cityId === id) p.cityId = null; });
  state.todos = state.todos.filter(t => !(t.ref?.type === 'city' && t.ref.id === id));
}
function deletePlace(id) {
  state.places = state.places.filter(p => p.id !== id);
  state.todos = state.todos.filter(t => !(t.ref?.type === 'place' && t.ref.id === id));
}

/* ---------- Countries geometry ---------- */

const PRETTY = {
  'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo', 'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Central African Rep.': 'Central African Republic', 'Dominican Rep.': 'Dominican Republic', 'Eq. Guinea': 'Equatorial Guinea',
  'S. Sudan': 'South Sudan', 'Solomon Is.': 'Solomon Islands', 'Falkland Is.': 'Falkland Islands',
  'Fr. S. Antarctic Lands': 'French Southern Lands', 'W. Sahara': 'Western Sahara', 'N. Cyprus': 'Northern Cyprus',
  'Marshall Is.': 'Marshall Islands', 'Cayman Is.': 'Cayman Islands', 'Turks and Caicos Is.': 'Turks and Caicos',
  'U.S. Virgin Is.': 'U.S. Virgin Islands', 'British Virgin Is.': 'British Virgin Islands', 'Faeroe Is.': 'Faroe Islands',
  'Cook Is.': 'Cook Islands', 'N. Mariana Is.': 'Northern Mariana Islands', 'St. Vin. and Gren.': 'St. Vincent and the Grenadines',
  'Antigua and Barb.': 'Antigua and Barbuda', 'S. Geo. and the Is.': 'South Georgia', 'Br. Indian Ocean Ter.': 'British Indian Ocean Territory',
  'Fr. Polynesia': 'French Polynesia', 'St. Pierre and Miquelon': 'Saint Pierre and Miquelon', 'Wallis and Futuna Is.': 'Wallis and Futuna',
  'Heard I. and McDonald Is.': 'Heard and McDonald Islands', 'Ashmore and Cartier Is.': 'Ashmore and Cartier Islands',
  'Indian Ocean Ter.': 'Indian Ocean Territories', 'eSwatini': 'Eswatini', 'Macedonia': 'North Macedonia',
  'Côte d\'Ivoire': 'Ivory Coast', 'São Tomé and Principe': 'São Tomé and Príncipe'
};

let worldFeatures = [];
let countryNames = [];

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolygon(lng, lat, poly) {
  if (!pointInRing(lng, lat, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(lng, lat, poly[k])) return false;
  return true;
}
function countryAt(lat, lng) {
  // Coastal cities can fall just outside the simplified borders, so look around a little.
  for (const d of [0, 0.25, 0.5]) {
    for (const [dy, dx] of d ? [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [d, -d], [-d, d], [-d, -d]] : [[0, 0]]) {
      const hit = countryAtExact(lat + dy, lng + dx);
      if (hit) return hit;
    }
  }
  return null;
}
function countryAtExact(lat, lng) {
  for (const f of worldFeatures) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    // Rings crossing the date line are unwrapped past ±180, so test both sides.
    if (polys.some(p => pointInPolygon(lng, lat, p) || pointInPolygon(lng + 360, lat, p) || pointInPolygon(lng - 360, lat, p))) return f.properties.name;
  }
  return null;
}

// Countries crossing the date line (Russia, Fiji…) jump from 180 to -180,
// which Leaflet draws as lines across the whole map. Make each ring continuous.
function unwrapRings(geometry) {
  if (!geometry) return;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      let offset = 0;
      for (let i = 1; i < ring.length; i++) {
        const prev = ring[i - 1][0];
        let lng = ring[i][0] + offset;
        if (lng - prev > 180) { offset -= 360; lng -= 360; }
        else if (prev - lng > 180) { offset += 360; lng += 360; }
        ring[i][0] = lng;
      }
    }
  }
}
function matchCountryName(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  return countryNames.find(c => c.toLowerCase() === n) || name;
}

/* ---------- Map ---------- */

const map = L.map('map', { worldCopyJump: true, zoomControl: false, minZoom: 2, tapHold: true }).setView([25, 10], 2);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap', maxZoom: 19
}).addTo(map);
map.createPane('pins').style.zIndex = 450;

let geoLayer = null;
const pinLayer = L.layerGroup().addTo(map);

function countryStyle(feature) {
  const name = feature.properties.name;
  const st = countryStatus(name);
  if (st === 'visited') {
    return { color: '#ffffff', weight: 1, fillColor: countryColor(name), fillOpacity: 0.65 };
  }
  if (st === 'wishlist') {
    const c = state.countries[name]?.color || WISH_COLOR;
    return { color: c, weight: 2, dashArray: '5 4', fillColor: c, fillOpacity: 0.15 };
  }
  return { color: '#9ca3af', weight: 0.5, fillColor: '#000', fillOpacity: 0 };
}

async function loadWorld() {
  try {
    const res = await fetch(WORLD_URL);
    const topo = await res.json();
    const fc = topojson.feature(topo, topo.objects.countries);
    fc.features.forEach(f => { f.properties.name = PRETTY[f.properties.name] || f.properties.name; unwrapRings(f.geometry); });
    worldFeatures = fc.features;
    countryNames = [...new Set(worldFeatures.map(f => f.properties.name))].sort((a, b) => a.localeCompare(b));
    geoLayer = L.geoJSON(fc, {
      style: countryStyle,
      onEachFeature: (f, layer) => {
        layer.on('click', () => openCountrySheet(f.properties.name));
      }
    }).addTo(map);
  } catch (e) {
    toast('Could not load the world map. Check your connection.');
  }
}

function renderMap() {
  if (geoLayer) geoLayer.setStyle(countryStyle);
  pinLayer.clearLayers();
  for (const c of state.cities) {
    if (c.lat == null) continue;
    const wish = c.status === 'wishlist';
    const color = c.color || (wish ? WISH_COLOR : COLORS[0]);
    L.circleMarker([c.lat, c.lng], {
      pane: 'pins', radius: 8, color: wish ? color : '#fff', weight: 2,
      dashArray: wish ? '3 3' : null, fillColor: color, fillOpacity: wish ? 0.25 : 0.95
    }).bindTooltip(esc(c.name)).on('click', e => { L.DomEvent.stop(e); openCitySheet(c.id); }).addTo(pinLayer);
  }
  for (const p of state.places) {
    if (p.lat == null) continue;
    const wish = p.status !== 'visited';
    L.circleMarker([p.lat, p.lng], {
      pane: 'pins', radius: 5, color: '#fff', weight: 1.5,
      fillColor: wish ? WISH_COLOR : '#1f2937', fillOpacity: 0.9
    }).bindTooltip(esc(p.name)).on('click', e => { L.DomEvent.stop(e); openPlaceSheet(p.id); }).addTo(pinLayer);
  }
}

map.on('contextmenu', e => openDropSheet(e.latlng));
setTimeout(() => { $('#mapHint').style.opacity = 0; }, 6000);

/* ---------- Tabs ---------- */

let currentView = 'map';
const ui = { citiesSeg: 'cities', wishSeg: 'countries', placesSeg: 'wishlist', todoSeg: 'open' };

$$('.tabbar button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

function showView(v) {
  currentView = v;
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  if (v === 'map') setTimeout(() => map.invalidateSize(), 50);
  renderView(v);
}

$('#fab').addEventListener('click', () => {
  if (currentView === 'cities' && ui.citiesSeg === 'countries') return openCountryPicker('visited');
  if (currentView === 'map' || currentView === 'cities') return openAddCitySheet('visited');
  if (currentView === 'wishlist') return ui.wishSeg === 'countries' ? openCountryPicker('wishlist') : openAddCitySheet('wishlist');
  if (currentView === 'places') return openAddPlaceSheet({ status: ui.placesSeg === 'visited' ? 'visited' : 'wishlist' });
  if (currentView === 'todo') return openTodoSheet(null);
});

function seg(key, options) {
  return `<div class="seg">${options.map(([v, label]) =>
    `<button data-seg="${key}" data-val="${v}" class="${ui[key] === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}
function bindSeg(root) {
  $$('[data-seg]', root).forEach(b => b.addEventListener('click', () => {
    ui[b.dataset.seg] = b.dataset.val;
    renderView(currentView);
  }));
}
function empty(icon, text) { return `<div class="empty"><b>${icon}</b>${text}</div>`; }

function renderStats() {
  const visitedCountries = Object.values(state.countries).filter(c => c.status === 'visited').length;
  const visitedCities = state.cities.filter(c => c.status === 'visited').length;
  const pct = Math.round(visitedCountries / TOTAL_COUNTRIES * 100);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  $('#stats').textContent = `${plural(visitedCountries, 'country', 'countries')} · ${plural(visitedCities, 'city', 'cities')} · ${pct}% of the world`;
}

function renderAll() {
  renderStats();
  renderMap();
  if (currentView !== 'map') renderView(currentView);
}

function renderView(v) {
  if (v === 'cities') renderCities();
  if (v === 'wishlist') renderWishlist();
  if (v === 'places') renderPlaces();
  if (v === 'todo') renderTodos();
}

function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it) || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function cityRow(c, extra = '') {
  const wish = c.status === 'wishlist';
  const color = c.color || (wish ? WISH_COLOR : COLORS[0]);
  const n = todosFor({ type: 'city', id: c.id }).filter(t => !t.done).length;
  const sub = [c.date && formatMonth(c.date), n && `${n} to do`, c.notes].filter(Boolean).join(' · ');
  return `<div class="row" data-city="${c.id}">
    <span class="dot ${wish ? 'hollow' : ''}" style="background:${color};color:${color}"></span>
    <div class="main"><div class="title">${esc(c.name)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
    ${extra}<span class="chev">›</span></div>`;
}

function formatMonth(m) {
  const [y, mo] = String(m).split('-');
  if (!mo) return y;
  return new Date(+y, +mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function bindRows(root) {
  $$('[data-city]', root).forEach(r => r.addEventListener('click', e => { if (!e.target.closest('[data-act]')) openCitySheet(r.dataset.city); }));
  $$('[data-place]', root).forEach(r => r.addEventListener('click', e => { if (!e.target.closest('[data-act]')) openPlaceSheet(r.dataset.place); }));
  $$('[data-country]', root).forEach(r => r.addEventListener('click', e => { if (!e.target.closest('[data-act]')) openCountrySheet(r.dataset.country); }));
  $$('[data-todo]', root).forEach(r => r.addEventListener('click', e => { if (!e.target.closest('[data-act]')) openTodoSheet(r.dataset.todo); }));
  $$('[data-act]', root).forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const [act, id] = b.dataset.act.split('|');
    if (act === 'city-been') { const c = getCity(id); c.status = 'visited'; markCountryVisited(c.country); toast(`${c.name} marked as visited 🎉`); }
    if (act === 'country-been') { setCountry(id, 'visited'); toast(`${id} marked as visited 🎉`); }
    if (act === 'place-toggle') { const p = getPlace(id); p.status = p.status === 'visited' ? 'wishlist' : 'visited'; }
    if (act === 'todo-toggle') { const t = state.todos.find(x => x.id === id); t.done = !t.done; }
    save();
  }));
}

function renderCities() {
  const root = $('#view-cities');
  const visited = state.cities.filter(c => c.status === 'visited');
  const countries = Object.entries(state.countries).filter(([, v]) => v.status === 'visited').map(([name]) => name).sort();
  let html = `<div class="statbar">
      <div><b>${countries.length}</b><span>countries</span></div>
      <div><b>${visited.length}</b><span>cities</span></div>
      <div><b>${state.places.filter(p => p.status === 'visited').length}</b><span>places</span></div>
    </div>`;
  html += seg('citiesSeg', [['cities', 'Cities'], ['countries', 'Countries']]);
  if (ui.citiesSeg === 'cities') {
    if (!visited.length) html += empty('🏙️', 'No cities yet. Tap + to add a city you have been to.');
    for (const [country, list] of groupBy(visited, c => c.country)) {
      html += `<div class="group"><div class="group-title"><span class="dot" style="background:${countryColor(country)}"></span>${esc(country)}<small>${list.length}</small></div>
        ${list.sort(byName).map(c => cityRow(c)).join('')}</div>`;
    }
  } else {
    if (!countries.length) html += empty('🌍', 'No countries yet. Tap a country on the map or tap +.');
    html += `<div class="group">${countries.map(name => {
      const n = state.cities.filter(c => c.country === name && c.status === 'visited').length;
      return `<div class="row" data-country="${esc(name)}"><span class="dot" style="background:${countryColor(name)}"></span>
        <div class="main"><div class="title">${esc(name)}</div><div class="sub">${n} ${n === 1 ? 'city' : 'cities'}</div></div><span class="chev">›</span></div>`;
    }).join('')}</div>`;
  }
  root.innerHTML = html;
  bindSeg(root); bindRows(root);
}

function renderWishlist() {
  const root = $('#view-wishlist');
  let html = '<h2>Wishlist</h2>' + seg('wishSeg', [['countries', 'Countries'], ['cities', 'Cities']]);
  if (ui.wishSeg === 'countries') {
    const list = Object.entries(state.countries).filter(([, v]) => v.status === 'wishlist').map(([n]) => n).sort();
    if (!list.length) html += empty('⭐', 'Dream destinations go here. Tap + to add a country.');
    else html += `<div class="group">${list.map(name => {
      const n = todosFor({ type: 'country', id: name }).filter(t => !t.done).length;
      return `<div class="row" data-country="${esc(name)}"><span class="dot hollow" style="color:${state.countries[name].color || WISH_COLOR}"></span>
        <div class="main"><div class="title">${esc(name)}</div>${n ? `<div class="sub">${n} to do</div>` : ''}</div>
        <button class="pill" data-act="country-been|${esc(name)}">Been ✓</button></div>`;
    }).join('')}</div>`;
  } else {
    const list = state.cities.filter(c => c.status === 'wishlist');
    if (!list.length) html += empty('⭐', 'Cities you want to visit go here. Tap + to add one.');
    for (const [country, cs] of groupBy(list, c => c.country)) {
      html += `<div class="group"><div class="group-title">${esc(country)}<small>${cs.length}</small></div>
        ${cs.sort(byName).map(c => cityRow(c, `<button class="pill" data-act="city-been|${c.id}">Been ✓</button>`)).join('')}</div>`;
    }
  }
  root.innerHTML = html;
  bindSeg(root); bindRows(root);
}

function placeRow(p) {
  const on = p.status === 'visited';
  const n = todosFor({ type: 'place', id: p.id }).filter(t => !t.done).length;
  const sub = [p.category, n && `${n} to do`, p.notes].filter(Boolean).join(' · ');
  return `<div class="row ${on ? '' : ''}" data-place="${p.id}">
    <button class="check ${on ? 'on' : ''}" data-act="place-toggle|${p.id}" aria-label="Visited">${on ? '✓' : ''}</button>
    <div class="main"><div class="title">${esc(p.name)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><span class="chev">›</span></div>`;
}

function placeGroupName(p) {
  const c = p.cityId && getCity(p.cityId);
  return c ? `${c.name}, ${c.country || ''}`.replace(/, $/, '') : (p.country || 'Other');
}

function renderPlaces() {
  const root = $('#view-places');
  let html = '<h2>Places</h2>' + seg('placesSeg', [['wishlist', 'Want to go'], ['visited', 'Been there']]);
  const list = state.places.filter(p => (p.status === 'visited') === (ui.placesSeg === 'visited'));
  if (!list.length) html += empty('📍', ui.placesSeg === 'visited'
    ? 'Tick a place when you have been there.'
    : 'Restaurants, museums, beaches, viewpoints… Tap + to add a specific place.');
  for (const [g, ps] of groupBy(list, placeGroupName)) {
    html += `<div class="group"><div class="group-title">${esc(g)}<small>${ps.length}</small></div>${ps.sort(byName).map(placeRow).join('')}</div>`;
  }
  root.innerHTML = html;
  bindSeg(root); bindRows(root);
}

function todoRow(t, showLoc) {
  return `<div class="row ${t.done ? 'done' : ''}" data-todo="${t.id}">
    <button class="check ${t.done ? 'on' : ''}" data-act="todo-toggle|${t.id}" aria-label="Done">${t.done ? '✓' : ''}</button>
    <div class="main"><div class="title">${esc(t.text)}</div>${showLoc ? `<div class="sub">${refIcon(t.ref)} ${esc(refLabel(t.ref))}</div>` : ''}</div></div>`;
}

function renderTodos() {
  const root = $('#view-todo');
  const open = ui.todoSeg === 'open';
  let html = '<h2>Things to do</h2>' + seg('todoSeg', [['open', 'To do'], ['done', 'Done']]);
  const list = state.todos.filter(t => !!t.done !== open);
  if (!list.length) html += empty('✅', open ? 'Your travel bucket list. Tap + to add something you want to do somewhere.' : 'Nothing checked off yet.');
  for (const [g, ts] of groupBy(list, t => refLabel(t.ref))) {
    html += `<div class="group"><div class="group-title">${refIcon(ts[0].ref)} ${esc(g)}<small>${ts.length}</small></div>${ts.map(t => todoRow(t, false)).join('')}</div>`;
  }
  root.innerHTML = html;
  bindSeg(root); bindRows(root);
}

/* ---------- Sheets ---------- */

const sheet = $('#sheet');
const backdrop = $('#sheetBackdrop');
let sheetRefresh = null;

function openSheet(html, onMount) {
  sheet.innerHTML = '<div class="grab"></div>' + html;
  sheet.hidden = false;
  backdrop.hidden = false;
  sheet.scrollTop = 0;
  sheetRefresh = null;
  if (onMount) onMount(sheet);
}
function closeSheet() {
  sheet.hidden = true;
  backdrop.hidden = true;
  sheet.innerHTML = '';
  sheetRefresh = null;
}
backdrop.addEventListener('click', closeSheet);

function swatchesHTML(selected) {
  return `<div class="swatches">${COLORS.map(c =>
    `<button class="swatch ${c === selected ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="Colour"></button>`).join('')}</div>`;
}
function bindSwatches(root, onPick) {
  $$('.swatch', root).forEach(b => b.addEventListener('click', () => {
    $$('.swatch', root).forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.color);
  }));
}
function statusButtons(current, withNone) {
  const opts = [['visited', '✓ Been'], ['wishlist', '⭐ Wishlist']];
  if (withNone) opts.push(['', 'None']);
  return `<div class="btns" style="margin-top:6px">${opts.map(([v, l]) =>
    `<button class="btn ${(current || '') === v ? 'on' : ''}" data-status="${v}">${l}</button>`).join('')}</div>`;
}
function bindStatus(root, onPick) {
  $$('[data-status]', root).forEach(b => b.addEventListener('click', () => {
    $$('[data-status]', root).forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.status || null);
  }));
}

/* Mini to-do list embedded in a sheet */
function mountTodoMini(container, ref) {
  const draw = () => {
    const list = todosFor(ref);
    container.innerHTML = `<label>Things to do here</label>
      <div class="todo-mini">${list.map(t => `
        <div class="row ${t.done ? 'done' : ''}">
          <button class="check ${t.done ? 'on' : ''}" data-tid="${t.id}">${t.done ? '✓' : ''}</button>
          <div class="main"><div class="title">${esc(t.text)}</div></div>
          <button class="icon-btn" data-del="${t.id}" aria-label="Delete">✕</button>
        </div>`).join('')}</div>
      <div class="inline-add"><input placeholder="Add something to do…" enterkeyhint="done"><button class="btn primary">Add</button></div>`;
    $$('[data-tid]', container).forEach(b => b.addEventListener('click', () => {
      const t = state.todos.find(x => x.id === b.dataset.tid); t.done = !t.done; save(); draw();
    }));
    $$('[data-del]', container).forEach(b => b.addEventListener('click', () => {
      state.todos = state.todos.filter(x => x.id !== b.dataset.del); save(); draw();
    }));
    const input = $('input', container);
    const add = () => {
      const text = input.value.trim();
      if (!text) return;
      state.todos.push({ id: uid(), text, done: false, ref });
      save(); draw();
      $('input', container).focus();
    };
    $('.inline-add button', container).addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  };
  draw();
}

/* Country */
function openCountrySheet(name) {
  const c = state.countries[name] || {};
  const cities = state.cities.filter(x => x.country === name).sort(byName);
  const places = state.places.filter(p => p.country === name && !p.cityId).sort(byName);
  openSheet(`
    <h2>${esc(name)}</h2>
    ${statusButtons(c.status, true)}
    <label>Colour on the map</label>${swatchesHTML(c.color || (c.status === 'wishlist' ? WISH_COLOR : countryColor(name)))}
    <label>Cities</label>
    <div class="group">${cities.map(x => cityRow(x)).join('') || '<div class="row"><div class="main sub">No cities yet</div></div>'}</div>
    ${places.length ? `<label>Places</label><div class="group">${places.map(placeRow).join('')}</div>` : ''}
    <div class="btns" style="margin-top:8px">
      <button class="btn" id="addCityHere">+ City</button>
      <button class="btn" id="addPlaceHere">+ Place</button>
    </div>
    <div id="todoMini"></div>
    <div class="btns"><button class="btn primary" id="done">Done</button></div>
  `, root => {
    bindStatus(root, st => { setCountry(name, st); save(); });
    bindSwatches(root, color => {
      state.countries[name] = Object.assign({ status: 'visited' }, state.countries[name], { color });
      save();
      $$('[data-status]', root).forEach(x => x.classList.toggle('on', x.dataset.status === state.countries[name].status));
    });
    bindRows(root);
    $('#addCityHere', root).addEventListener('click', () => openAddCitySheet(c.status === 'wishlist' ? 'wishlist' : 'visited', name));
    $('#addPlaceHere', root).addEventListener('click', () => openAddPlaceSheet({ country: name }));
    mountTodoMini($('#todoMini', root), { type: 'country', id: name });
    $('#done', root).addEventListener('click', closeSheet);
  });
}

function openCountryPicker(status) {
  if (!countryNames.length) return toast('Map is still loading…');
  openSheet(`
    <h2>${status === 'wishlist' ? 'Add to wishlist' : 'Add a country'}</h2>
    <input id="q" placeholder="Search countries…" autocomplete="off">
    <div class="results group" id="list" style="margin-top:10px"></div>
  `, root => {
    const draw = () => {
      const q = $('#q', root).value.trim().toLowerCase();
      $('#list', root).innerHTML = countryNames.filter(n => n.toLowerCase().includes(q)).slice(0, 60).map(n => {
        const st = countryStatus(n);
        return `<div class="row" data-pick="${esc(n)}"><div class="main"><div class="title">${esc(n)}</div></div>${st ? `<span class="sub">${st === 'visited' ? '✓ Been' : '⭐'}</span>` : ''}</div>`;
      }).join('');
      $$('[data-pick]', root).forEach(r => r.addEventListener('click', () => {
        setCountry(r.dataset.pick, status); save(); closeSheet(); toast(`${r.dataset.pick} added`);
      }));
    };
    $('#q', root).addEventListener('input', draw);
    draw();
  });
}

/* Geocoding search (OpenStreetMap Nominatim) */
async function geoSearch(q, kind) {
  const params = new URLSearchParams({ format: 'jsonv2', q, addressdetails: '1', limit: '8', 'accept-language': 'en' });
  if (kind === 'city') params.set('featureType', 'settlement');
  const res = await fetch('https://nominatim.openstreetmap.org/search?' + params);
  if (!res.ok) throw new Error('search failed');
  return res.json();
}

function bindSearch(root, kind, onPick, countryHint) {
  const input = $('#q', root);
  const out = $('#results', root);
  let timer;
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) { out.innerHTML = ''; return; }
    out.innerHTML = '<div class="sub">Searching…</div>';
    try {
      const results = await geoSearch(countryHint ? `${q}, ${countryHint}` : q, kind);
      if (!results.length) { out.innerHTML = '<div class="sub">No results. Try another spelling, or long-press the map to drop a pin.</div>'; return; }
      out.innerHTML = results.map((r, i) => `<div class="row" data-i="${i}"><div class="main">
        <div class="title">${esc(r.name || r.display_name.split(',')[0])}</div>
        <div class="sub">${esc(r.display_name)}</div></div></div>`).join('');
      $$('[data-i]', out).forEach(row => row.addEventListener('click', () => {
        const r = results[+row.dataset.i];
        const lat = +r.lat, lng = +r.lon;
        onPick({
          name: r.name || r.display_name.split(',')[0],
          lat, lng,
          country: countryAt(lat, lng) || matchCountryName(r.address?.country),
          category: r.type && r.type !== 'yes' ? r.type.replace(/_/g, ' ') : ''
        });
      }));
    } catch (e) {
      out.innerHTML = '<div class="sub">Search needs an internet connection.</div>';
    }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 700); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
  setTimeout(() => input.focus(), 100);
}

/* Cities */
function openAddCitySheet(status, countryHint) {
  openSheet(`
    <h2>${status === 'wishlist' ? 'Add a city to your wishlist' : 'Add a city you have been to'}</h2>
    ${countryHint ? `<p class="sub">in ${esc(countryHint)}</p>` : ''}
    <input id="q" placeholder="Search a city…" autocomplete="off" enterkeyhint="search">
    <div class="results" id="results"></div>
  `, root => bindSearch(root, 'city', r => {
    const city = { id: uid(), name: r.name, country: r.country, lat: r.lat, lng: r.lng, status, color: null, date: '', notes: '' };
    state.cities.push(city);
    if (status === 'visited') markCountryVisited(city.country);
    else if (!countryStatus(city.country)) setCountry(city.country, 'wishlist');
    save();
    openCitySheet(city.id);
    toast(`${city.name} added`);
  }, countryHint));
}

function openCitySheet(id) {
  const c = getCity(id);
  if (!c) return closeSheet();
  const draft = { status: c.status, color: c.color || (c.status === 'wishlist' ? WISH_COLOR : COLORS[0]) };
  const places = state.places.filter(p => p.cityId === id).sort(byName);
  openSheet(`
    <h2>${esc(c.name)}</h2>
    <p class="sub">${esc(c.country || '')}</p>
    ${statusButtons(c.status, false)}
    <label>Colour</label>${swatchesHTML(draft.color)}
    <label>Name</label><input id="name" value="${esc(c.name)}">
    <label>When</label><input id="date" type="month" value="${esc(c.date || '')}">
    <label>Notes</label><textarea id="notes" placeholder="Memories, tips, who you went with…">${esc(c.notes || '')}</textarea>
    <label>Places in ${esc(c.name)}</label>
    <div class="group">${places.map(placeRow).join('') || '<div class="row"><div class="main sub">No places yet</div></div>'}</div>
    <div class="btns" style="margin-top:8px"><button class="btn" id="addPlace">+ Add a place here</button></div>
    <div id="todoMini"></div>
    <div class="btns">
      <button class="btn primary" id="save">Save</button>
      <button class="btn" id="show">Show on map</button>
      <button class="btn danger" id="del">Delete</button>
    </div>
  `, root => {
    bindStatus(root, st => { draft.status = st; });
    bindSwatches(root, col => { draft.color = col; });
    bindRows(root);
    mountTodoMini($('#todoMini', root), { type: 'city', id });
    const commit = () => {
      c.name = $('#name', root).value.trim() || c.name;
      c.date = $('#date', root).value;
      c.notes = $('#notes', root).value.trim();
      c.status = draft.status;
      c.color = draft.color;
      if (c.status === 'visited') markCountryVisited(c.country);
      save();
    };
    $('#addPlace', root).addEventListener('click', () => { commit(); openAddPlaceSheet({ cityId: id, country: c.country }); });
    $('#save', root).addEventListener('click', () => { commit(); closeSheet(); });
    $('#show', root).addEventListener('click', () => { commit(); closeSheet(); showView('map'); setTimeout(() => map.flyTo([c.lat, c.lng], 11), 100); });
    $('#del', root).addEventListener('click', () => {
      if (!confirm(`Delete ${c.name}?`)) return;
      deleteCity(id); save(); closeSheet();
    });
  });
}

/* Places */
function nearestCity(lat, lng, maxKm = 40) {
  let best = null, bestD = Infinity;
  for (const c of state.cities) {
    if (c.lat == null) continue;
    const d = Math.hypot((c.lat - lat) * 111, (c.lng - lng) * 111 * Math.cos(lat * Math.PI / 180));
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= maxKm ? best : null;
}

function cityOptions(selected) {
  return `<option value="">— None —</option>` + [...state.cities].sort(byName).map(c =>
    `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}${c.country ? ', ' + esc(c.country) : ''}</option>`).join('');
}

function openAddPlaceSheet(defaults = {}) {
  const hintCity = defaults.cityId && getCity(defaults.cityId);
  const hint = hintCity ? `${hintCity.name}, ${hintCity.country || ''}` : defaults.country;
  openSheet(`
    <h2>Add a place</h2>
    ${hint ? `<p class="sub">near ${esc(hint)}</p>` : ''}
    <input id="q" placeholder="Search: restaurant, museum, beach…" autocomplete="off" enterkeyhint="search">
    <div class="results" id="results"></div>
    <label>Or just type a name</label>
    <div class="inline-add"><input id="manual" placeholder="e.g. Grandma's favourite café"><button class="btn primary" id="addManual">Add</button></div>
  `, root => {
    const create = r => {
      const city = defaults.cityId ? getCity(defaults.cityId) : (r.lat != null ? nearestCity(r.lat, r.lng) : null);
      const p = {
        id: uid(), name: r.name, lat: r.lat ?? null, lng: r.lng ?? null,
        country: r.country || city?.country || defaults.country || null,
        cityId: city?.id || null, category: r.category || '', status: defaults.status || 'wishlist', notes: ''
      };
      state.places.push(p);
      save();
      openPlaceSheet(p.id);
      toast(`${p.name} added`);
    };
    bindSearch(root, 'place', create, hint);
    const manual = () => {
      const name = $('#manual', root).value.trim();
      if (name) create({ name, lat: hintCity?.lat ?? null, lng: hintCity?.lng ?? null });
    };
    $('#addManual', root).addEventListener('click', manual);
    $('#manual', root).addEventListener('keydown', e => { if (e.key === 'Enter') manual(); });
  });
}

function openPlaceSheet(id) {
  const p = getPlace(id);
  if (!p) return closeSheet();
  const draft = { status: p.status };
  openSheet(`
    <h2>${esc(p.name)}</h2>
    <p class="sub">${esc([p.category, placeGroupName(p)].filter(Boolean).join(' · '))}</p>
    ${statusButtons(p.status, false)}
    <label>Name</label><input id="name" value="${esc(p.name)}">
    <label>City</label><select id="city">${cityOptions(p.cityId)}</select>
    <label>Notes</label><textarea id="notes" placeholder="Why go, opening hours, what to order…">${esc(p.notes || '')}</textarea>
    <div id="todoMini"></div>
    <div class="btns">
      <button class="btn primary" id="save">Save</button>
      ${p.lat != null ? '<button class="btn" id="show">Show on map</button>' : ''}
      <button class="btn danger" id="del">Delete</button>
    </div>
  `, root => {
    bindStatus(root, st => { draft.status = st; });
    mountTodoMini($('#todoMini', root), { type: 'place', id });
    const commit = () => {
      p.name = $('#name', root).value.trim() || p.name;
      p.cityId = $('#city', root).value || null;
      if (p.cityId) p.country = getCity(p.cityId).country || p.country;
      p.notes = $('#notes', root).value.trim();
      p.status = draft.status;
      if (p.status === 'visited') markCountryVisited(p.country);
      save();
    };
    $('#save', root).addEventListener('click', () => { commit(); closeSheet(); });
    $('#show', root)?.addEventListener('click', () => { commit(); closeSheet(); showView('map'); setTimeout(() => map.flyTo([p.lat, p.lng], 15), 100); });
    $('#del', root).addEventListener('click', () => {
      if (!confirm(`Delete ${p.name}?`)) return;
      deletePlace(id); save(); closeSheet();
    });
  });
}

/* Long-press on the map */
function openDropSheet(latlng) {
  const country = countryAt(latlng.lat, latlng.lng);
  let kind = 'city', status = 'visited';
  openSheet(`
    <h2>Add here</h2>
    <p class="sub">${esc(country || 'Somewhere in the world')}</p>
    <div class="btns" style="margin-top:6px">
      <button class="btn on" data-kind="city">🏙️ City</button>
      <button class="btn" data-kind="place">📍 Place</button>
    </div>
    ${statusButtons(status, false)}
    <label>Name</label><input id="name" placeholder="Name">
    <div class="btns"><button class="btn primary" id="save">Add</button></div>
  `, root => {
    $$('[data-kind]', root).forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.kind;
      $$('[data-kind]', root).forEach(x => x.classList.toggle('on', x === b));
    }));
    bindStatus(root, st => { status = st; });
    setTimeout(() => $('#name', root).focus(), 100);
    $('#save', root).addEventListener('click', () => {
      const name = $('#name', root).value.trim();
      if (!name) return $('#name', root).focus();
      const base = { id: uid(), name, lat: latlng.lat, lng: latlng.lng, country, status, notes: '' };
      if (kind === 'city') {
        state.cities.push(Object.assign(base, { color: null, date: '' }));
        if (status === 'visited') markCountryVisited(country);
      } else {
        const city = nearestCity(latlng.lat, latlng.lng);
        state.places.push(Object.assign(base, { cityId: city?.id || null, category: '' }));
        if (status === 'visited') markCountryVisited(country);
      }
      save(); closeSheet(); toast(`${name} added`);
    });
  });
}

/* To-dos */
function locationOptions(selectedKey) {
  const opt = (key, label) => `<option value="${esc(key)}" ${key === selectedKey ? 'selected' : ''}>${esc(label)}</option>`;
  const countries = Object.keys(state.countries).sort();
  const cities = [...state.cities].sort(byName);
  const places = [...state.places].sort(byName);
  return opt('', 'General (no place)')
    + (countries.length ? `<optgroup label="Countries">${countries.map(n => opt('country:' + n, n)).join('')}</optgroup>` : '')
    + (cities.length ? `<optgroup label="Cities">${cities.map(c => opt('city:' + c.id, `${c.name}${c.country ? ', ' + c.country : ''}`)).join('')}</optgroup>` : '')
    + (places.length ? `<optgroup label="Places">${places.map(p => opt('place:' + p.id, p.name)).join('')}</optgroup>` : '');
}

function openTodoSheet(id) {
  const t = id ? state.todos.find(x => x.id === id) : null;
  openSheet(`
    <h2>${t ? 'Edit' : 'Something to do'}</h2>
    <label>What do you want to do?</label>
    <input id="text" value="${esc(t?.text || '')}" placeholder="e.g. Eat pastéis de nata at Belém">
    <label>Where</label>
    <select id="loc">${locationOptions(refKey(t?.ref))}</select>
    <div class="btns">
      <button class="btn primary" id="save">Save</button>
      ${t ? '<button class="btn danger" id="del">Delete</button>' : ''}
    </div>
  `, root => {
    if (!t) setTimeout(() => $('#text', root).focus(), 100);
    $('#save', root).addEventListener('click', () => {
      const text = $('#text', root).value.trim();
      if (!text) return $('#text', root).focus();
      const ref = parseRef($('#loc', root).value);
      if (t) { t.text = text; t.ref = ref; }
      else state.todos.push({ id: uid(), text, done: false, ref });
      save(); closeSheet();
    });
    $('#del', root)?.addEventListener('click', () => {
      state.todos = state.todos.filter(x => x.id !== id); save(); closeSheet();
    });
  });
}

/* Settings & backup */
$('#settingsBtn').addEventListener('click', () => {
  openSheet(`
    <h2>Settings &amp; backup</h2>
    <p class="sub">Your data lives only on this phone. Make a backup now and then so you never lose it.</p>
    <div class="btns">
      <button class="btn primary" id="export">⬇︎ Save backup</button>
      <button class="btn" id="import">⬆︎ Restore backup</button>
    </div>
    <input type="file" id="file" accept="application/json,.json" hidden>
    <h3>Add to home screen</h3>
    <p class="sub" style="margin-top:0">iPhone: open in Safari → Share → <b>Add to Home Screen</b>.<br>
    Android: open in Chrome → ⋮ menu → <b>Add to Home screen / Install app</b>.</p>
    <div class="btns"><button class="btn danger" id="reset">Erase everything</button></div>
  `, root => {
    $('#export', root).addEventListener('click', exportData);
    $('#import', root).addEventListener('click', () => $('#file', root).click());
    $('#file', root).addEventListener('change', e => importData(e.target.files[0]));
    $('#reset', root).addEventListener('click', () => {
      if (!confirm('Erase ALL your travel data? This cannot be undone.')) return;
      state = emptyState(); save(); closeSheet();
    });
  });
});

async function exportData() {
  const json = JSON.stringify(state, null, 2);
  const name = `travel-map-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Travel map backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !Array.isArray(data.cities)) throw new Error('bad');
      if (!confirm('Replace your current data with this backup?')) return;
      state = Object.assign(emptyState(), data);
      save(); closeSheet(); toast('Backup restored');
    } catch (e) {
      toast('That file is not a travel map backup');
    }
  };
  reader.readAsText(file);
}

/* ---------- Start ---------- */

renderAll();
loadWorld();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
