import * as THREE from 'three';
import * as Satellites from './satellites.js';
import * as Utils from './utils.js';
import * as Globe from './globe.js';
import { CONFIG, debounce, throttle, formatCoord, formatAlt, formatSpeed, computeNextPass, formatRelativeTime, getOrbitRegime } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────────

let selectedSatName = null;
let selectedCategory = 'all';
let userLocation = null;
let userMarker = null;
let userToSatLine = null;
let showOrbit = false;

// Time simulation
let timeMultiplier = 1;
let simTimeOffset = 0; // ms offset from real time
let paused = false;

// ── DOM refs ───────────────────────────────────────────────────────────────────

const el = {};

// Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ── Init ───────────────────────────────────────────────────────────────────────

export function init(scene) {
  // Cache DOM elements
  el.satName = document.getElementById('sat-name');
  el.satNorad = document.getElementById('sat-norad');
  el.satLat = document.getElementById('sat-lat');
  el.satLon = document.getElementById('sat-lon');
  el.satAlt = document.getElementById('sat-alt');
  el.satSpeed = document.getElementById('sat-speed');
  el.satVisibility = document.getElementById('sat-visibility');
  el.satElevation = document.getElementById('sat-elevation');
  el.satCategoryVal = document.getElementById('sat-category');
  el.satTotalBadge = document.getElementById('sat-total-badge');
  el.satInfoLink = document.getElementById('sat-info-link');
  el.telemetry = document.getElementById('telemetry');
  el.btnOrbits = document.getElementById('btn-orbits');
  el.btnLocate = document.getElementById('btn-locate');
  el.loading = document.getElementById('loading');
  el.utcClock = document.getElementById('utc-clock');
  el.searchInput = document.getElementById('search-input');
  el.searchResults = document.getElementById('search-results');
  el.searchClear = document.getElementById('search-clear');
  el.filterBar = document.getElementById('filter-bar');
  el.btnTimePause = document.getElementById('btn-time-pause');
  el.btnTimeSpeed = document.getElementById('btn-time-speed');
  el.btnTimeReset = document.getElementById('btn-time-reset');
  el.errorOverlay = document.getElementById('error-overlay');
  el.satOrbitRegime = document.getElementById('sat-regime');
  el.satNextPass = document.getElementById('sat-next-pass');
  el.legend = document.getElementById('color-legend');

  // Hide telemetry on start
  el.telemetry.classList.add('hidden');

  el.satTotalBadge.textContent = Satellites.getCount() + ' objects';

  // Build color legend
  buildLegend();

  // Orbit toggle
  el.btnOrbits.addEventListener('click', toggleOrbit);

  // Locate
  el.btnLocate.addEventListener('click', requestUserLocation);

  // Filter chips — generate from CONFIG
  initFilterChips();

  // Search
  initSearch();

  // Time controls
  initTimeControls();

  // Hover detection (throttled)
  const canvas = Globe.getRenderer().domElement;
  canvas.addEventListener('pointermove', throttle(onPointerMove, CONFIG.PICK_THROTTLE_MS));

  // Click picking (with drag detection)
  let mouseDownPos = null;
  canvas.addEventListener('pointerdown', (e) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!mouseDownPos) return;
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, Globe.getCamera());
      const picked = Satellites.pickSatellite(raycaster);
      if (picked) {
        selectSatellite(picked.name);
      } else {
        deselectSatellite();
      }
    }
    mouseDownPos = null;
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', onKeyDown);

  // User-to-satellite line
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: CONFIG.USER_LINE_VISIBLE_COLOR,
    transparent: true,
    opacity: 0.4,
  });
  userToSatLine = new THREE.Line(lineGeo, lineMat);
  userToSatLine.visible = false;
  scene.add(userToSatLine);

  // UTC clock
  setInterval(updateClock, 1000);
  updateClock();

  // Restore persisted state
  restoreState();

  // Save camera state periodically
  setInterval(saveCameraState, 5000);
}

// ── Filter chips (generated from CONFIG) ───────────────────────────────────────

function initFilterChips() {
  if (!el.filterBar) return;

  el.filterBar.innerHTML = '';
  const counts = Satellites.getCategoryCounts();

  const allChip = createChip('all', 'All', counts.all);
  allChip.classList.add('active');
  el.filterBar.appendChild(allChip);

  for (const [key, group] of Object.entries(CONFIG.SATELLITE_GROUPS)) {
    if (key === 'active') continue;
    el.filterBar.appendChild(createChip(key, group.label, counts[key] || 0));
  }

  el.filterBar.appendChild(createChip('active', CONFIG.SATELLITE_GROUPS.active.label, counts.active || 0));
}

function createChip(cat, label, count) {
  const btn = document.createElement('button');
  btn.className = 'filter-chip';
  btn.dataset.cat = cat;
  btn.innerHTML = count !== undefined
    ? `${escapeHtml(label)} <span class="chip-count">${count}</span>`
    : escapeHtml(label);
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', cat === 'all' ? 'true' : 'false');
  btn.addEventListener('click', () => {
    el.filterBar.querySelectorAll('.filter-chip').forEach(c => {
      c.classList.remove('active');
      c.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    selectedCategory = cat;
    Satellites.filterByCategory(cat);
    el.satTotalBadge.textContent = Satellites.getVisibleCount() + ' objects';
    saveState();
  });
  return btn;
}

// ── Search ─────────────────────────────────────────────────────────────────────

function initSearch() {
  if (!el.searchInput) return;

  const handleSearch = debounce(() => {
    const query = el.searchInput.value.trim();
    el.searchClear.style.display = query ? 'flex' : 'none';

    if (query.length < 2) {
      el.searchResults.classList.add('hidden');
      return;
    }

    const results = Satellites.search(query);
    renderSearchResults(results);
  }, CONFIG.SEARCH_DEBOUNCE_MS);

  el.searchInput.addEventListener('input', handleSearch);

  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      el.searchInput.value = '';
      el.searchResults.classList.add('hidden');
      el.searchClear.style.display = 'none';
      el.searchInput.blur();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = el.searchResults.querySelector('.search-item');
      if (first) first.focus();
    }
  });

  el.searchClear.addEventListener('click', () => {
    el.searchInput.value = '';
    el.searchResults.classList.add('hidden');
    el.searchClear.style.display = 'none';
    el.searchInput.focus();
  });

  // Close search results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-container')) {
      el.searchResults.classList.add('hidden');
    }
  });
}

function renderSearchResults(results) {
  el.searchResults.innerHTML = '';
  if (results.length === 0) {
    el.searchResults.innerHTML = '<div class="search-empty">No satellites found</div>';
    el.searchResults.classList.remove('hidden');
    return;
  }

  for (const sat of results) {
    const item = document.createElement('button');
    item.className = 'search-item';
    item.setAttribute('role', 'option');
    item.innerHTML = `
      <span class="search-item-name">${escapeHtml(sat.name)}</span>
      <span class="search-item-cat">${sat.category}</span>
    `;
    item.addEventListener('click', () => {
      selectSatellite(sat.name);
      el.searchInput.value = sat.name;
      el.searchResults.classList.add('hidden');
      // Fly camera to satellite
      if (sat.position.lengthSq() > 0) {
        Globe.flyTo(sat.position);
      }
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = item.nextElementSibling;
        if (next) next.focus();
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = item.previousElementSibling;
        if (prev) prev.focus(); else el.searchInput.focus();
      }
      if (e.key === 'Escape') {
        el.searchResults.classList.add('hidden');
        el.searchInput.focus();
      }
    });
    el.searchResults.appendChild(item);
  }
  el.searchResults.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Time controls ──────────────────────────────────────────────────────────────

function initTimeControls() {
  if (!el.btnTimePause) return;

  el.btnTimePause.addEventListener('click', () => {
    paused = !paused;
    el.btnTimePause.classList.toggle('active', paused);
    el.btnTimePause.querySelector('.btn-label').textContent = paused ? 'Play' : 'Pause';
    el.btnTimePause.setAttribute('aria-label', paused ? 'Resume time' : 'Pause time');
  });

  el.btnTimeSpeed.addEventListener('click', () => {
    const speeds = [1, 10, 100, 1000];
    const idx = speeds.indexOf(timeMultiplier);
    timeMultiplier = speeds[(idx + 1) % speeds.length];
    el.btnTimeSpeed.querySelector('.btn-label').textContent = timeMultiplier + 'x';
  });

  el.btnTimeReset.addEventListener('click', () => {
    timeMultiplier = 1;
    simTimeOffset = 0;
    paused = false;
    el.btnTimePause.classList.remove('active');
    el.btnTimePause.querySelector('.btn-label').textContent = 'Pause';
    el.btnTimeSpeed.querySelector('.btn-label').textContent = '1x';
  });
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────

function onKeyDown(e) {
  // Don't handle shortcuts when typing in search
  if (e.target === el.searchInput) return;

  switch (e.key) {
    case '/':
    case 'f':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        el.searchInput.focus();
      }
      break;
    case 'Escape':
      deselectSatellite();
      break;
    case 'o':
      if (selectedSatName) toggleOrbit();
      break;
    case ' ':
      e.preventDefault();
      el.btnTimePause.click();
      break;
  }
}

// ── Hover ──────────────────────────────────────────────────────────────────────

function onPointerMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, Globe.getCamera());
  const hovered = Satellites.pickSatellite(raycaster);
  Satellites.setHover(hovered);
  Globe.getRenderer().domElement.style.cursor = hovered ? 'pointer' : '';
}

// ── Clock ──────────────────────────────────────────────────────────────────────

function updateClock() {
  if (!el.utcClock) return;
  const simDate = getSimTime();
  el.utcClock.textContent = simDate.toISOString().slice(11, 19) + ' UTC';
}

// ── Selection ──────────────────────────────────────────────────────────────────

export function selectSatellite(name) {
  selectedSatName = name;
  Satellites.highlightSatellite(name);
  el.telemetry.classList.remove('hidden');
  el.btnOrbits.removeAttribute('disabled');
  el.btnOrbits.setAttribute('aria-disabled', 'false');

  if (showOrbit) {
    Satellites.showOrbitPath(name, getSimTime());
  }

  // Always show ground track
  Satellites.showGroundTrack(name, getSimTime());

  // Compute next pass (async-like, in background)
  computeNextPassForSelected();

  saveState();
}

export function deselectSatellite() {
  if (!selectedSatName) return;
  selectedSatName = null;
  Satellites.clearHighlight();
  Satellites.hideOrbitPath();
  Satellites.hideGroundTrack();
  Satellites.setHover(null);
  el.telemetry.classList.add('hidden');
  showOrbit = false;
  el.btnOrbits.classList.remove('active');
  el.btnOrbits.setAttribute('disabled', '');
  el.btnOrbits.setAttribute('aria-disabled', 'true');
  if (userToSatLine) userToSatLine.visible = false;

  // Clear URL hash
  history.replaceState(null, '', window.location.pathname);
  try { localStorage.removeItem(CONFIG.STORAGE_KEY_SELECTED); } catch {}
}

function toggleOrbit() {
  if (!selectedSatName) return;
  showOrbit = !showOrbit;
  el.btnOrbits.classList.toggle('active', showOrbit);
  if (showOrbit) {
    Satellites.showOrbitPath(selectedSatName, getSimTime());
  } else {
    Satellites.hideOrbitPath();
  }
}

// ── Telemetry panel ────────────────────────────────────────────────────────────

export function updatePanel() {
  if (!selectedSatName) return;
  const sat = Satellites.getByName(selectedSatName);
  if (!sat) return;

  const noradId = sat.satrec.satnum;
  el.satName.textContent = sat.name;
  el.satNorad.textContent = 'NORAD ' + noradId;
  el.satLat.textContent = formatCoord(sat.geodetic.lat, 'N', 'S');
  el.satLon.textContent = formatCoord(sat.geodetic.lon, 'E', 'W');
  el.satAlt.textContent = formatAlt(sat.geodetic.alt);
  el.satSpeed.textContent = formatSpeed(sat.speed);
  el.satCategoryVal.textContent = CONFIG.SATELLITE_GROUPS[sat.category]?.label || sat.category;
  if (el.satOrbitRegime) el.satOrbitRegime.textContent = getOrbitRegime(sat.geodetic.alt);
  el.satInfoLink.href = 'https://www.n2yo.com/satellite/?s=' + noradId;

  // Update orbit path if time warp is active
  if (showOrbit && timeMultiplier !== 1) {
    Satellites.showOrbitPath(selectedSatName, getSimTime());
  }

  if (userLocation && sat.lastEci && sat.lastGmst) {
    const vis = Utils.isVisible(userLocation.lat, userLocation.lon, userLocation.alt || 0, sat.lastEci, sat.lastGmst);
    if (vis.visible) {
      el.satVisibility.textContent = 'ABOVE HORIZON';
      el.satVisibility.className = 'telem-row-value visible-yes';
    } else {
      el.satVisibility.textContent = 'Below horizon';
      el.satVisibility.className = 'telem-row-value visible-no';
    }
    el.satElevation.textContent = vis.elevation.toFixed(1) + '\u00B0';
    updateUserLine(sat, vis.visible);
  } else {
    el.satVisibility.textContent = 'Click Locate me';
    el.satVisibility.className = 'telem-row-value';
    el.satElevation.textContent = '--';
    if (userToSatLine) userToSatLine.visible = false;
  }
}

export function updateLabels() {
  Satellites.updateLabels(Globe.getCamera(), Globe.getScene());
}

// ── User location ──────────────────────────────────────────────────────────────

function updateUserLine(sat, visible) {
  if (!userLocation || !userToSatLine) return;
  const userPos = Utils.geoToSurface(userLocation.lat, userLocation.lon);
  const attr = userToSatLine.geometry.attributes.position;
  attr.setXYZ(0, userPos.x, userPos.y, userPos.z);
  attr.setXYZ(1, sat.position.x, sat.position.y, sat.position.z);
  attr.needsUpdate = true;
  userToSatLine.visible = visible;
  userToSatLine.material.color.set(visible ? CONFIG.USER_LINE_VISIBLE_COLOR : CONFIG.USER_LINE_HIDDEN_COLOR);
  userToSatLine.material.opacity = visible ? 0.4 : 0.15;
}

async function requestUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation(pos.coords.latitude, pos.coords.longitude, (pos.coords.altitude || 0) / 1000);
      },
      () => {
        fallbackIPLocation();
      },
      { timeout: 5000, enableHighAccuracy: false }
    );
  } else {
    fallbackIPLocation();
  }
}

async function fallbackIPLocation() {
  const apis = [
    'https://ipapi.co/json/',
    'https://ip-api.com/json/?fields=lat,lon',
  ];
  for (const url of apis) {
    try {
      const resp = await Utils.fetchWithTimeout(url, 5000);
      if (!resp.ok) continue;
      const data = await resp.json();
      const lat = data.latitude || data.lat;
      const lon = data.longitude || data.lon;
      if (lat && lon) {
        setUserLocation(lat, lon, 0);
        return;
      }
    } catch { continue; }
  }
  // Paris fallback
  setUserLocation(48.8566, 2.3522, 0);
}

function setUserLocation(lat, lon, altKm) {
  userLocation = { lat, lon, alt: altKm };
  const scene = Globe.getScene();
  if (userMarker) scene.remove(userMarker);

  const pos = Utils.geoToSurface(lat, lon);
  const geo = new THREE.SphereGeometry(1.0, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: CONFIG.USER_MARKER_COLOR });
  userMarker = new THREE.Mesh(geo, mat);
  userMarker.position.copy(pos);
  scene.add(userMarker);

  const spriteMat = new THREE.SpriteMaterial({
    color: CONFIG.USER_MARKER_COLOR,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Sprite(spriteMat);
  glow.scale.set(5, 5, 1);
  userMarker.add(glow);

  el.btnLocate.classList.add('active');
}

// ── Loading & errors ───────────────────────────────────────────────────────────

export function hideLoading() {
  el.loading.classList.add('hidden');
  setTimeout(() => { el.loading.style.display = 'none'; }, 800);
}

export function showError(message) {
  if (el.errorOverlay) {
    el.errorOverlay.querySelector('.error-text').textContent = message;
    el.errorOverlay.classList.remove('hidden');
  }
}

// ── Next pass prediction ────────────────────────────────────────────────────────

let nextPassResult = null;

function computeNextPassForSelected() {
  if (!selectedSatName || !userLocation) {
    if (el.satNextPass) el.satNextPass.textContent = 'Locate me first';
    return;
  }
  const sat = Satellites.getByName(selectedSatName);
  if (!sat) return;

  if (el.satNextPass) el.satNextPass.textContent = 'Computing...';

  // Run in a setTimeout to avoid blocking the frame
  setTimeout(() => {
    const now = getSimTime();
    const pass = computeNextPass(sat.satrec, userLocation.lat, userLocation.lon, userLocation.alt || 0, now);
    if (pass) {
      nextPassResult = pass;
      if (el.satNextPass) el.satNextPass.textContent = formatRelativeTime(pass, now) + ' (' + pass.toISOString().slice(11, 16) + ' UTC)';
    } else {
      nextPassResult = null;
      if (el.satNextPass) el.satNextPass.textContent = 'None in 24h';
    }
  }, 10);
}

// ── Color legend ────────────────────────────────────────────────────────────────

function buildLegend() {
  if (!el.legend) return;
  el.legend.innerHTML = '';
  for (const [key, group] of Object.entries(CONFIG.SATELLITE_GROUPS)) {
    if (key === 'active') continue;
    const color = CONFIG.CATEGORY_COLORS[key] || CONFIG.CATEGORY_COLORS.active;
    const hex = '#' + new THREE.Color(color).getHexString();
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="background:${hex}"></span>${escapeHtml(group.label)}`;
    el.legend.appendChild(item);
  }
}

// ── Simulated time ─────────────────────────────────────────────────────────────

let lastRealTime = performance.now();

export function getSimTime() {
  const now = performance.now();
  if (!paused) {
    const delta = now - lastRealTime;
    simTimeOffset += delta * (timeMultiplier - 1);
  }
  lastRealTime = now;
  return new Date(Date.now() + simTimeOffset);
}

export function getTimeMultiplier() { return timeMultiplier; }
export function getSelectedSatName() { return selectedSatName; }

// ── Persistence ────────────────────────────────────────────────────────────────

function saveState() {
  try {
    if (selectedSatName) {
      localStorage.setItem(CONFIG.STORAGE_KEY_SELECTED, selectedSatName);
      history.replaceState(null, '', '#sat=' + encodeURIComponent(selectedSatName));
    }
    if (selectedCategory !== 'all') {
      localStorage.setItem(CONFIG.STORAGE_KEY_CATEGORY, selectedCategory);
    }
  } catch { /* storage unavailable */ }
}

function saveCameraState() {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY_CAMERA, JSON.stringify(Globe.getCameraState()));
  } catch { /* storage unavailable */ }
}

function restoreState() {
  // Restore category
  try {
    const savedCat = localStorage.getItem(CONFIG.STORAGE_KEY_CATEGORY);
    if (savedCat && CONFIG.SATELLITE_GROUPS[savedCat]) {
      selectedCategory = savedCat;
      Satellites.filterByCategory(savedCat);
      el.satTotalBadge.textContent = Satellites.getVisibleCount() + ' objects';
      el.filterBar.querySelectorAll('.filter-chip').forEach(c => {
        const isActive = c.dataset.cat === savedCat;
        c.classList.toggle('active', isActive);
        c.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }
  } catch { /* ignore */ }

  // Restore camera
  try {
    const savedCam = localStorage.getItem(CONFIG.STORAGE_KEY_CAMERA);
    if (savedCam) Globe.restoreCameraState(JSON.parse(savedCam));
  } catch { /* ignore */ }

  // Restore selection from URL hash or localStorage
  const hash = window.location.hash;
  let satName = null;
  if (hash.startsWith('#sat=')) {
    satName = decodeURIComponent(hash.slice(5));
  } else {
    try { satName = localStorage.getItem(CONFIG.STORAGE_KEY_SELECTED); } catch {}
  }
  if (satName) {
    // Defer selection until satellites are positioned
    setTimeout(() => {
      const sat = Satellites.getByName(satName);
      if (sat) selectSatellite(satName);
    }, 100);
  }
}
