import * as THREE from 'three';
import * as Satellites from './satellites.js';
import * as Utils from './utils.js';
import * as Globe from './globe.js';
import { CONFIG, debounce, throttle, formatCoord, formatAlt, formatSpeed, getOrbitRegime } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────────

let selectedSatName = null;
const selectedSats = new Set(); // multi-selection
let selectedCategory = 'all';
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
  el.satCategoryVal = document.getElementById('sat-category');
  el.satTotalBadge = document.getElementById('sat-total-badge');
  el.satInfoLink = document.getElementById('sat-info-link');
  el.telemetry = document.getElementById('telemetry');
  el.btnOrbits = document.getElementById('btn-orbits');
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
  el.legend = document.getElementById('color-legend');

  // Hide telemetry on start
  el.telemetry.classList.add('hidden');

  el.satTotalBadge.textContent = Satellites.getCount() + ' objects';

  // Build color legend
  buildLegend();

  // Orbit toggle
  el.btnOrbits.addEventListener('click', toggleOrbit);

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
        if (e.ctrlKey || e.metaKey) {
          // Multi-select toggle
          if (selectedSats.has(picked.name)) {
            selectedSats.delete(picked.name);
          } else {
            selectedSats.add(picked.name);
          }
          selectedSatName = picked.name;
          Satellites.highlightMultiple(selectedSats);
          el.telemetry.classList.remove('hidden');
          el.btnOrbits.removeAttribute('disabled');
          el.btnOrbits.setAttribute('aria-disabled', 'false');
          if (showOrbit) {
            Satellites.showMultiOrbitPaths([...selectedSats], getSimTime());
          }
          updatePanel();
        } else {
          selectedSats.clear();
          selectedSats.add(picked.name);
          Satellites.hideMultiOrbitPaths();
          selectSatellite(picked.name);
        }
      } else {
        deselectSatellite();
      }
    }
    mouseDownPos = null;
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', onKeyDown);

  // Theme toggle
  initTheme();

  // Details modal
  initDetailsModal();

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
    const picker = document.getElementById('time-picker');
    if (picker) picker.style.display = 'none';
  });

  // Date/time picker
  const btnPick = document.getElementById('btn-time-pick');
  const picker = document.getElementById('time-picker');
  if (btnPick && picker) {
    btnPick.addEventListener('click', () => {
      const visible = picker.style.display !== 'none';
      if (visible) {
        picker.style.display = 'none';
      } else {
        const now = getSimTime();
        picker.value = now.toISOString().slice(0, 16);
        picker.style.display = '';
        picker.focus();
      }
    });
    picker.addEventListener('change', () => {
      const target = new Date(picker.value + 'Z');
      if (!isNaN(target.getTime())) {
        simTimeOffset = target.getTime() - Date.now();
        lastRealTime = performance.now();
      }
    });
  }
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
    // Globe keyboard navigation
    case 'ArrowLeft':
      e.preventDefault();
      rotateGlobe(0.05, 0);
      break;
    case 'ArrowRight':
      e.preventDefault();
      rotateGlobe(-0.05, 0);
      break;
    case 'ArrowUp':
      e.preventDefault();
      rotateGlobe(0, -0.05);
      break;
    case 'ArrowDown':
      e.preventDefault();
      rotateGlobe(0, 0.05);
      break;
    case '+':
    case '=':
      e.preventDefault();
      zoomGlobe(-10);
      break;
    case '-':
      e.preventDefault();
      zoomGlobe(10);
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

  saveState();
}

export function deselectSatellite() {
  if (!selectedSatName && selectedSats.size === 0) return;
  selectedSatName = null;
  selectedSats.clear();
  Satellites.clearHighlight();
  Satellites.hideOrbitPath();
  Satellites.hideMultiOrbitPaths();
  Satellites.hideGroundTrack();
  Satellites.setHover(null);
  el.telemetry.classList.add('hidden');
  showOrbit = false;
  el.btnOrbits.classList.remove('active');
  el.btnOrbits.setAttribute('disabled', '');
  el.btnOrbits.setAttribute('aria-disabled', 'true');

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
    if (selectedSats.size > 1) {
      Satellites.showMultiOrbitPaths([...selectedSats].filter(n => n !== selectedSatName), getSimTime());
    }
  } else {
    Satellites.hideOrbitPath();
    Satellites.hideMultiOrbitPaths();
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

  // Refresh orbit path and ground track if visible
  if (showOrbit) {
    Satellites.showOrbitPath(selectedSatName, getSimTime());
  }
  Satellites.showGroundTrack(selectedSatName, getSimTime());
}

export function updateLabels() {
  Satellites.updateLabels(Globe.getCamera(), Globe.getScene());
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

// ── Satellite details modal ──────────────────────────────────────────────────────

function initDetailsModal() {
  const btn = document.getElementById('btn-sat-details');
  const modal = document.getElementById('sat-modal');
  const closeBtn = document.getElementById('modal-close');
  if (!btn || !modal) return;

  btn.addEventListener('click', () => {
    if (!selectedSatName) return;
    const elems = Satellites.getOrbitalElements(selectedSatName);
    if (!elems) return;

    document.getElementById('modal-title').textContent = selectedSatName;
    const body = document.getElementById('modal-body');
    body.innerHTML = [
      ['NORAD ID', elems.noradId],
      ['Inclination', elems.inclination + '\u00B0'],
      ['RAAN', elems.raan + '\u00B0'],
      ['Eccentricity', elems.eccentricity],
      ['Arg. of Perigee', elems.argPerigee + '\u00B0'],
      ['Mean Anomaly', elems.meanAnomaly + '\u00B0'],
      ['Mean Motion', elems.meanMotion + ' rad/min'],
      ['Period', elems.periodMin + ' min'],
      ['B* Drag', elems.bstar],
      ['Epoch', elems.epochYear + '/' + elems.epochDay],
      ['Category', CONFIG.SATELLITE_GROUPS[elems.category]?.label || elems.category],
    ].map(([label, value]) =>
      `<div class="modal-row"><span class="modal-row-label">${escapeHtml(label)}</span><span class="modal-row-value">${escapeHtml(String(value))}</span></div>`
    ).join('');

    modal.classList.remove('hidden');
  });

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
    }
  });

  // Export buttons
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    if (!selectedSatName) return;
    const points = Satellites.generateEphemeris(selectedSatName, getSimTime(), 24, 1);
    if (!points) return;
    downloadFile(Satellites.ephemerisToCSV(points), selectedSatName.replace(/\s+/g, '_') + '_ephemeris.csv', 'text/csv');
  });
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    if (!selectedSatName) return;
    const points = Satellites.generateEphemeris(selectedSatName, getSimTime(), 24, 1);
    if (!points) return;
    downloadFile(JSON.stringify({ satellite: selectedSatName, ephemeris: points }, null, 2), selectedSatName.replace(/\s+/g, '_') + '_ephemeris.json', 'application/json');
  });
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Globe keyboard navigation ────────────────────────────────────────────────────

function rotateGlobe(dTheta, dPhi) {
  const controls = Globe.getControls();
  const camera = Globe.getCamera();
  const offset = camera.position.clone().sub(controls.target);
  const r = offset.length();
  let theta = Math.atan2(offset.x, offset.z) + dTheta;
  let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / r))) + dPhi;
  phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));
  camera.position.set(
    controls.target.x + r * Math.sin(phi) * Math.sin(theta),
    controls.target.y + r * Math.cos(phi),
    controls.target.z + r * Math.sin(phi) * Math.cos(theta)
  );
  camera.lookAt(controls.target);
}

function zoomGlobe(delta) {
  const camera = Globe.getCamera();
  const controls = Globe.getControls();
  const dir = camera.position.clone().sub(controls.target).normalize();
  const newPos = camera.position.clone().add(dir.multiplyScalar(delta));
  const dist = newPos.distanceTo(controls.target);
  if (dist >= controls.minDistance && dist <= controls.maxDistance) {
    camera.position.copy(newPos);
  }
}

// ── Theme toggle ────────────────────────────────────────────────────────────────

function initTheme() {
  const btn = document.getElementById('btn-theme');
  const iconDark = document.getElementById('theme-icon-dark');
  const iconLight = document.getElementById('theme-icon-light');
  if (!btn) return;

  // Restore saved theme
  try {
    const saved = localStorage.getItem('ot_theme');
    if (saved === 'light') {
      document.documentElement.classList.add('light');
      iconDark.style.display = 'none';
      iconLight.style.display = '';
    }
  } catch {}

  btn.addEventListener('click', () => {
    const isLight = document.documentElement.classList.toggle('light');
    iconDark.style.display = isLight ? 'none' : '';
    iconLight.style.display = isLight ? '' : 'none';
    try { localStorage.setItem('ot_theme', isLight ? 'light' : 'dark'); } catch {}
  });
}

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
