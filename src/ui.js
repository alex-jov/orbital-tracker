import * as THREE from 'three';
import * as Satellites from './satellites.js';
import * as Utils from './utils.js';
import * as Globe from './globe.js';

let selectedSatName = null;
let selectedCategory = 'all';
let userLocation = null;
let userMarker = null;
let userToSatLine = null;
let showOrbit = false;

const el = {};

// Raycaster shared between hover and click
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

export function init(scene) {
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

  // Hide telemetry on start
  el.telemetry.classList.add('hidden');

  el.satTotalBadge.textContent = Satellites.getCount() + ' objects';

  // Orbit toggle
  el.btnOrbits.addEventListener('click', () => {
    if (!selectedSatName) return;
    showOrbit = !showOrbit;
    el.btnOrbits.classList.toggle('active', showOrbit);
    if (showOrbit) {
      Satellites.showOrbitPath(selectedSatName, new Date());
    } else {
      Satellites.hideOrbitPath();
    }
  });

  // Locate
  el.btnLocate.addEventListener('click', requestUserLocation);

  // Category filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedCategory = chip.dataset.cat;
      Satellites.filterByCategory(selectedCategory);
      el.satTotalBadge.textContent = Satellites.getVisibleCount() + ' objects';
    });
  });

  // Hover detection
  const canvas = Globe.getRenderer().domElement;
  canvas.addEventListener('pointermove', onPointerMove);

  // Click picking
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
      const picked = Satellites.pickSatellite(raycaster, Globe.getCamera());
      if (picked) selectSatellite(picked.name);
    }
    mouseDownPos = null;
  });

  // User-to-satellite line
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.4 });
  userToSatLine = new THREE.Line(lineGeo, lineMat);
  userToSatLine.visible = false;
  scene.add(userToSatLine);

  // UTC clock
  setInterval(updateClock, 1000);
  updateClock();
}

function onPointerMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, Globe.getCamera());
  const hovered = Satellites.pickSatellite(raycaster, Globe.getCamera());
  Satellites.setHover(hovered);
  Globe.getRenderer().domElement.style.cursor = hovered ? 'pointer' : '';
}

function updateClock() {
  if (!el.utcClock) return;
  const now = new Date();
  el.utcClock.textContent = now.toISOString().slice(11, 19) + ' UTC';
}

export function selectSatellite(name) {
  selectedSatName = name;
  Satellites.highlightSatellite(name);
  // Show telemetry panel
  el.telemetry.classList.remove('hidden');
  if (showOrbit) {
    Satellites.showOrbitPath(name, new Date());
  }
}

export function updatePanel() {
  if (!selectedSatName) return;
  const sat = Satellites.getByName(selectedSatName);
  if (!sat) return;

  const noradId = sat.satrec.satnum;
  el.satName.textContent = sat.name;
  el.satNorad.textContent = 'NORAD ' + noradId;
  el.satLat.textContent = sat.geodetic.lat.toFixed(4) + '\u00B0';
  el.satLon.textContent = sat.geodetic.lon.toFixed(4) + '\u00B0';
  el.satAlt.textContent = sat.geodetic.alt.toFixed(1) + ' km';
  el.satSpeed.textContent = (sat.speed * 3600).toFixed(0) + ' km/h';
  el.satCategoryVal.textContent = sat.category || '--';

  el.satInfoLink.href = 'https://www.n2yo.com/satellite/?s=' + noradId;

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

// Update labels each frame
export function updateLabels() {
  Satellites.updateLabels(Globe.getCamera(), Globe.getScene());
}

function updateUserLine(sat, visible) {
  if (!userLocation || !userToSatLine) return;
  const userPos = Utils.geoToSurface(userLocation.lat, userLocation.lon);
  const attr = userToSatLine.geometry.attributes.position;
  attr.setXYZ(0, userPos.x, userPos.y, userPos.z);
  attr.setXYZ(1, sat.position.x, sat.position.y, sat.position.z);
  attr.needsUpdate = true;
  userToSatLine.visible = visible;
  userToSatLine.material.color.set(visible ? 0x34d399 : 0xf87171);
  userToSatLine.material.opacity = visible ? 0.4 : 0.15;
}

async function requestUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.log('Geolocation OK:', pos.coords.latitude, pos.coords.longitude);
        setUserLocation(pos.coords.latitude, pos.coords.longitude, (pos.coords.altitude || 0) / 1000);
      },
      (err) => {
        console.log('Geolocation denied/failed:', err.message, '- using IP fallback');
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
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = await resp.json();
      const lat = data.latitude || data.lat;
      const lon = data.longitude || data.lon;
      if (lat && lon) {
        console.log('IP geolocation OK:', lat, lon, 'from', url);
        setUserLocation(lat, lon, 0);
        return;
      }
    } catch (e) { continue; }
  }
  console.log('All geolocation failed, using Paris fallback');
  setUserLocation(48.8566, 2.3522, 0);
}

function setUserLocation(lat, lon, altKm) {
  userLocation = { lat, lon, alt: altKm };
  const scene = Globe.getScene();
  if (userMarker) scene.remove(userMarker);

  const pos = Utils.geoToSurface(lat, lon);
  const geo = new THREE.SphereGeometry(1.0, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
  userMarker = new THREE.Mesh(geo, mat);
  userMarker.position.copy(pos);
  scene.add(userMarker);

  const spriteMat = new THREE.SpriteMaterial({
    color: 0x34d399, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Sprite(spriteMat);
  glow.scale.set(5, 5, 1);
  userMarker.add(glow);

  el.btnLocate.classList.add('active');
}

export function hideLoading() {
  el.loading.classList.add('hidden');
  setTimeout(() => { el.loading.style.display = 'none'; }, 800);
}

export function getTimeMultiplier() { return 1; }
export function getSelectedSatName() { return selectedSatName; }
