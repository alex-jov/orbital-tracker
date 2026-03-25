import * as THREE from 'three';
import { GLOBE_RADIUS, CONFIG, geoTo3D, computeSpeed, fetchWithRetry } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────────

const allSatellites = [];
let activeCategory = 'all';
let visibleCount = 0;

// ── GPU rendering ──────────────────────────────────────────────────────────────

let pointsMesh = null;
let pointsGeo = null;
let positionsAttr = null;
let colorsAttr = null;
let sizesAttr = null;

// ── Orbit path (reused buffer) ─────────────────────────────────────────────────

let selectedOrbitLine = null;
const orbitPositions = new Float32Array(CONFIG.ORBIT_STEPS * 3 + 3);
let orbitAttr = null;

// ── Ground track (reused buffer) ───────────────────────────────────────────────

let groundTrackLine = null;
const groundTrackPositions = new Float32Array(CONFIG.GROUND_TRACK_STEPS * 3 + 3);
let groundTrackAttr = null;

// ── Hover ring ─────────────────────────────────────────────────────────────────

let hoverRing = null;

// ── Label sprite pool (fixed size, reused) ─────────────────────────────────────

const labelPool = [];
const labelActiveMap = new Map(); // satName -> poolIndex

// ── Fallback TLEs ──────────────────────────────────────────────────────────────

const FALLBACK_TLES = [
  { name: 'ISS (ZARYA)', line1: '1 25544U 98067A   24100.50000000  .00016717  00000-0  10270-3 0  9005', line2: '2 25544  51.6400 208.9163 0002526 105.8218 324.2478 15.49908950999990' },
  { name: 'HUBBLE', line1: '1 20580U 90037B   24100.50000000  .00000764  00000-0  39468-4 0  9998', line2: '2 20580  28.4699 135.4567 0002495 105.7823  32.3547 15.09429891000018' },
  { name: 'TIANGONG', line1: '1 48274U 21035A   24100.50000000  .00020000  00000-0  22440-3 0  9990', line2: '2 48274  41.4700 150.2345 0004500  30.1234 330.0123 15.62000000000010' },
  { name: 'NOAA 19', line1: '1 33591U 09005A   24100.50000000  .00000072  00000-0  63298-4 0  9998', line2: '2 33591  99.1690 120.4567 0014081 105.9560 254.3214 14.12384455000012' },
  { name: 'GPS BIIR-2', line1: '1 28474U 04045A   24100.50000000  .00000010  00000-0  10000-3 0  9998', line2: '2 28474  55.2300  45.6000 0070000  40.0000 320.5000  2.00563000000010' },
];

// ── Init ───────────────────────────────────────────────────────────────────────

export function initRenderer(scene) {
  // Single Points mesh for all satellites
  pointsGeo = new THREE.BufferGeometry();
  positionsAttr = new THREE.Float32BufferAttribute(new Float32Array(CONFIG.MAX_SATS * 3), 3);
  colorsAttr = new THREE.Float32BufferAttribute(new Float32Array(CONFIG.MAX_SATS * 3), 3);
  sizesAttr = new THREE.Float32BufferAttribute(new Float32Array(CONFIG.MAX_SATS), 1);
  positionsAttr.setUsage(THREE.DynamicDrawUsage);
  colorsAttr.setUsage(THREE.DynamicDrawUsage);

  pointsGeo.setAttribute('position', positionsAttr);
  pointsGeo.setAttribute('color', colorsAttr);
  pointsGeo.setAttribute('size', sizesAttr);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPixelRatio * (120.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 10.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.3, 0.5, d);
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  });

  pointsMesh = new THREE.Points(pointsGeo, mat);
  pointsMesh.frustumCulled = false;
  scene.add(pointsMesh);

  // Hover ring
  const ringCanvas = document.createElement('canvas');
  ringCanvas.width = 64;
  ringCanvas.height = 64;
  const rctx = ringCanvas.getContext('2d');
  rctx.strokeStyle = '#ffffff';
  rctx.lineWidth = 2.5;
  rctx.beginPath();
  rctx.arc(32, 32, 24, 0, Math.PI * 2);
  rctx.stroke();
  const ringTexture = new THREE.CanvasTexture(ringCanvas);
  const ringMat = new THREE.SpriteMaterial({ map: ringTexture, transparent: true, depthTest: false });
  hoverRing = new THREE.Sprite(ringMat);
  hoverRing.scale.set(CONFIG.HOVER_RING_SIZE, CONFIG.HOVER_RING_SIZE, 1);
  hoverRing.visible = false;
  scene.add(hoverRing);

  // Orbit path line — pre-allocated reusable buffer
  const orbitGeo = new THREE.BufferGeometry();
  orbitAttr = new THREE.Float32BufferAttribute(orbitPositions, 3);
  orbitAttr.setUsage(THREE.DynamicDrawUsage);
  orbitGeo.setAttribute('position', orbitAttr);
  orbitGeo.setDrawRange(0, 0);
  const orbitMat = new THREE.LineBasicMaterial({
    color: CONFIG.ORBIT_COLOR,
    transparent: true,
    opacity: CONFIG.ORBIT_OPACITY,
  });
  selectedOrbitLine = new THREE.Line(orbitGeo, orbitMat);
  selectedOrbitLine.frustumCulled = false;
  scene.add(selectedOrbitLine);

  // Ground track line — projected orbit on globe surface
  const gtGeo = new THREE.BufferGeometry();
  groundTrackAttr = new THREE.Float32BufferAttribute(groundTrackPositions, 3);
  groundTrackAttr.setUsage(THREE.DynamicDrawUsage);
  gtGeo.setAttribute('position', groundTrackAttr);
  gtGeo.setDrawRange(0, 0);
  const gtMat = new THREE.LineDashedMaterial({
    color: CONFIG.GROUND_TRACK_COLOR,
    transparent: true,
    opacity: CONFIG.GROUND_TRACK_OPACITY,
    dashSize: 2,
    gapSize: 1,
  });
  groundTrackLine = new THREE.Line(gtGeo, gtMat);
  groundTrackLine.frustumCulled = false;
  groundTrackLine.computeLineDistances();
  scene.add(groundTrackLine);

  // Pre-allocate label sprite pool
  initLabelPool(scene);
}

// ── Label pool ─────────────────────────────────────────────────────────────────

function initLabelPool(scene) {
  for (let i = 0; i < CONFIG.LABEL_POOL_SIZE; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 48;
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(10, 1.2, 1);
    sprite.center.set(0, 0.5);
    sprite.visible = false;
    scene.add(sprite);
    labelPool.push({ sprite, canvas, texture, currentName: null });
  }
}

function setLabelText(poolEntry, name) {
  if (poolEntry.currentName === name) return;
  poolEntry.currentName = name;
  const ctx = poolEntry.canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 48);
  ctx.font = '500 22px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'left';
  ctx.fillText(name, 4, 32);
  poolEntry.texture.needsUpdate = true;
}

// ── TLE parsing ────────────────────────────────────────────────────────────────

function parseTLEText(text, category) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const results = [];

  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      if (lines[i].startsWith('1 ') && lines[i + 1].startsWith('2 ')) {
        i -= 1;
        continue;
      }
      continue;
    }

    try {
      const satrec = satellite.twoline2satrec(line1, line2);
      if (satrec.error === 0) {
        results.push({ name: name.replace(/^\d+\s+/, '').trim() || name, satrec, category });
      }
    } catch {
      // Skip invalid TLEs silently
    }
  }
  return results;
}

// ── Fetch ──────────────────────────────────────────────────────────────────────

export async function fetchSatellites(groupsToFetch = Object.keys(CONFIG.SATELLITE_GROUPS), onProgress) {
  const results = [];
  let fetched = 0;

  const fetches = groupsToFetch.map(async (group) => {
    const groupConfig = CONFIG.SATELLITE_GROUPS[group];
    if (!groupConfig) return;
    try {
      const resp = await fetchWithRetry(groupConfig.url);
      const text = await resp.text();
      const parsed = parseTLEText(text, group);
      results.push(...parsed);
      fetched++;
      if (onProgress) onProgress(fetched, groupsToFetch.length, group, parsed.length);
    } catch (e) {
      console.warn(`Failed to fetch ${group}:`, e.message);
      fetched++;
      if (onProgress) onProgress(fetched, groupsToFetch.length, group, 0);
    }
  });

  await Promise.allSettled(fetches);

  if (results.length === 0) {
    console.warn('All fetches failed — using fallback TLE data');
    for (const f of FALLBACK_TLES) {
      try {
        const satrec = satellite.twoline2satrec(f.line1, f.line2);
        results.push({ name: f.name, satrec, category: 'stations' });
      } catch { /* skip */ }
    }
  }

  // Sort: specific groups before 'active' for dedup priority
  results.sort((a, b) => {
    if (a.category === 'active' && b.category !== 'active') return 1;
    if (a.category !== 'active' && b.category === 'active') return -1;
    return 0;
  });

  // Deduplicate by NORAD ID
  const seen = new Set();
  allSatellites.length = 0;
  visibleCount = 0;

  for (const sat of results) {
    const noradId = sat.satrec.satnum;
    if (seen.has(noradId)) continue;
    seen.add(noradId);

    const catColor = CONFIG.CATEGORY_COLORS[sat.category] || CONFIG.CATEGORY_COLORS.active;
    const color = new THREE.Color(catColor);
    allSatellites.push({
      name: sat.name,
      satrec: sat.satrec,
      category: sat.category,
      color,
      geodetic: { lat: 0, lon: 0, alt: 0 },
      speed: 0,
      lastEci: null,
      lastGmst: null,
      position: new THREE.Vector3(),
    });
  }

  visibleCount = allSatellites.length;
  pointsGeo.setDrawRange(0, allSatellites.length);

  // Set initial colors and sizes
  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    colorsAttr.setXYZ(i, sat.color.r, sat.color.g, sat.color.b);
    sizesAttr.setX(i, sat.name.includes('ISS') ? CONFIG.SAT_SIZE_ISS : CONFIG.SAT_SIZE_DEFAULT);
  }
  colorsAttr.needsUpdate = true;
  sizesAttr.needsUpdate = true;

  return allSatellites.length;
}

// ── Position update ────────────────────────────────────────────────────────────

export function update(date) {
  const gmst = satellite.gstime(date);

  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    const posVel = satellite.propagate(sat.satrec, date);
    if (!posVel.position || posVel.position === false) continue;

    const eci = posVel.position;
    const vel = posVel.velocity;

    sat.lastEci = eci;
    sat.lastGmst = gmst;

    const geodetic = satellite.eciToGeodetic(eci, gmst);
    sat.geodetic.lat = satellite.degreesLat(geodetic.latitude);
    sat.geodetic.lon = satellite.degreesLong(geodetic.longitude);
    sat.geodetic.alt = geodetic.height;
    sat.speed = computeSpeed(vel);

    const pos = geoTo3D(sat.geodetic.lat, sat.geodetic.lon, sat.geodetic.alt);
    sat.position.copy(pos);

    const show = activeCategory === 'all' || sat.category === activeCategory;
    if (show) {
      positionsAttr.setXYZ(i, pos.x, pos.y, pos.z);
    } else {
      positionsAttr.setXYZ(i, 0, 0, 0);
    }
  }

  positionsAttr.needsUpdate = true;
}

// ── Filtering ──────────────────────────────────────────────────────────────────

export function filterByCategory(category) {
  activeCategory = category;
  visibleCount = 0;
  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    const show = category === 'all' || sat.category === category;
    sizesAttr.setX(i, show ? CONFIG.SAT_SIZE_DEFAULT : CONFIG.SAT_SIZE_HIDDEN);
    if (show) {
      positionsAttr.setXYZ(i, sat.position.x, sat.position.y, sat.position.z);
      visibleCount++;
    } else {
      positionsAttr.setXYZ(i, 0, 0, 0);
    }
  }
  sizesAttr.needsUpdate = true;
  positionsAttr.needsUpdate = true;
}

export function getVisibleCount() {
  return visibleCount;
}

export function getActiveCategory() {
  return activeCategory;
}

// ── Selection & highlight ──────────────────────────────────────────────────────

export function highlightSatellite(name) {
  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    const catVisible = activeCategory === 'all' || sat.category === activeCategory;
    if (!catVisible) { sizesAttr.setX(i, CONFIG.SAT_SIZE_HIDDEN); continue; }
    sizesAttr.setX(i, sat.name === name ? CONFIG.SAT_SIZE_HIGHLIGHTED : CONFIG.SAT_SIZE_DEFAULT);
  }
  sizesAttr.needsUpdate = true;
}

export function clearHighlight() {
  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    const catVisible = activeCategory === 'all' || sat.category === activeCategory;
    sizesAttr.setX(i, catVisible ? CONFIG.SAT_SIZE_DEFAULT : CONFIG.SAT_SIZE_HIDDEN);
  }
  sizesAttr.needsUpdate = true;
}

// ── Orbit path (reuses pre-allocated buffer) ───────────────────────────────────

export function showOrbitPath(name, baseDate) {
  const sat = getByName(name);
  if (!sat) {
    selectedOrbitLine.geometry.setDrawRange(0, 0);
    return;
  }

  selectedOrbitLine.material.color.copy(sat.color);

  const period = (2 * Math.PI) / sat.satrec.no; // minutes
  const steps = CONFIG.ORBIT_STEPS;
  const stepMin = period / steps;
  let count = 0;

  for (let i = 0; i <= steps; i++) {
    const t = new Date(baseDate.getTime() + i * stepMin * 60000);
    const posVel = satellite.propagate(sat.satrec, t);
    if (!posVel.position || posVel.position === false) continue;
    const gmst = satellite.gstime(t);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    const lat = satellite.degreesLat(geo.latitude);
    const lon = satellite.degreesLong(geo.longitude);
    const p = geoTo3D(lat, lon, geo.height);
    orbitPositions[count * 3] = p.x;
    orbitPositions[count * 3 + 1] = p.y;
    orbitPositions[count * 3 + 2] = p.z;
    count++;
  }

  orbitAttr.needsUpdate = true;
  selectedOrbitLine.geometry.setDrawRange(0, count);
}

export function hideOrbitPath() {
  selectedOrbitLine.geometry.setDrawRange(0, 0);
  hideGroundTrack();
}

// ── Ground track (orbit projected onto surface) ────────────────────────────────

export function showGroundTrack(name, baseDate) {
  const sat = getByName(name);
  if (!sat) { hideGroundTrack(); return; }

  const period = (2 * Math.PI) / sat.satrec.no;
  const steps = CONFIG.GROUND_TRACK_STEPS;
  const stepMin = period / steps;
  let count = 0;

  for (let i = 0; i <= steps; i++) {
    const t = new Date(baseDate.getTime() + i * stepMin * 60000);
    const posVel = satellite.propagate(sat.satrec, t);
    if (!posVel.position || posVel.position === false) continue;
    const gmst = satellite.gstime(t);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    const lat = satellite.degreesLat(geo.latitude);
    const lon = satellite.degreesLong(geo.longitude);
    // Project onto surface (alt=0) with tiny offset to avoid z-fighting
    const p = geoTo3D(lat, lon, 5);
    groundTrackPositions[count * 3] = p.x;
    groundTrackPositions[count * 3 + 1] = p.y;
    groundTrackPositions[count * 3 + 2] = p.z;
    count++;
  }

  groundTrackAttr.needsUpdate = true;
  groundTrackLine.geometry.setDrawRange(0, count);
  groundTrackLine.computeLineDistances();
}

export function hideGroundTrack() {
  if (groundTrackLine) groundTrackLine.geometry.setDrawRange(0, 0);
}

// ── Picking ────────────────────────────────────────────────────────────────────

export function pickSatellite(raycaster) {
  const ray = raycaster.ray;
  let bestDist = Infinity;
  let bestSat = null;

  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    if (sat.position.lengthSq() === 0) continue;
    const catVisible = activeCategory === 'all' || sat.category === activeCategory;
    if (!catVisible) continue;
    const dist = ray.distanceToPoint(sat.position);
    if (dist < CONFIG.PICK_THRESHOLD && dist < bestDist) {
      bestDist = dist;
      bestSat = sat;
    }
  }
  return bestSat;
}

// ── Hover ──────────────────────────────────────────────────────────────────────

export function setHover(sat) {
  if (!hoverRing) return;
  if (sat) {
    hoverRing.position.copy(sat.position);
    hoverRing.visible = true;
  } else {
    hoverRing.visible = false;
  }
}

// ── Labels (uses sprite pool) ──────────────────────────────────────────────────

export function updateLabels(camera, scene) {
  const camPos = camera.position;
  const camDist = camPos.length();
  const showLabels = camDist < GLOBE_RADIUS * CONFIG.LABEL_ZOOM_THRESHOLD_MULT;

  if (!showLabels) {
    for (const entry of labelPool) entry.sprite.visible = false;
    labelActiveMap.clear();
    return;
  }

  const camDir = camPos.clone().normalize();
  const candidates = [];

  for (const sat of allSatellites) {
    if (sat.position.lengthSq() === 0) continue;
    const catVisible = activeCategory === 'all' || sat.category === activeCategory;
    if (!catVisible) continue;
    const satDir = sat.position.clone().normalize();
    if (satDir.dot(camDir) < CONFIG.LABEL_DOT_THRESHOLD) continue;
    const dist = camPos.distanceTo(sat.position);
    candidates.push({ sat, dist });
  }

  candidates.sort((a, b) => a.dist - b.dist);
  const maxLabels = camDist < GLOBE_RADIUS * CONFIG.LABEL_CLOSE_DIST_MULT
    ? CONFIG.LABEL_MAX_CLOSE
    : camDist < GLOBE_RADIUS * CONFIG.LABEL_MID_DIST_MULT
      ? CONFIG.LABEL_MAX_MID
      : CONFIG.LABEL_MAX_FAR;

  const toShow = candidates.slice(0, Math.min(maxLabels, labelPool.length));
  const newActiveMap = new Map();

  // Assign pool entries to visible satellites
  let poolIdx = 0;
  for (const { sat } of toShow) {
    if (poolIdx >= labelPool.length) break;
    const entry = labelPool[poolIdx];
    setLabelText(entry, sat.name);
    const offset = sat.position.clone().normalize().multiplyScalar(1.5);
    entry.sprite.position.copy(sat.position).add(offset);
    entry.sprite.visible = true;
    newActiveMap.set(sat.name, poolIdx);
    poolIdx++;
  }

  // Hide unused pool entries
  for (let i = poolIdx; i < labelPool.length; i++) {
    labelPool[i].sprite.visible = false;
  }

  labelActiveMap.clear();
  for (const [k, v] of newActiveMap) labelActiveMap.set(k, v);
}

// ── Search ─────────────────────────────────────────────────────────────────────

export function search(query) {
  if (!query || query.length < 2) return [];
  const q = query.toUpperCase();
  const results = [];
  for (const sat of allSatellites) {
    if (sat.name.toUpperCase().includes(q)) {
      results.push(sat);
      if (results.length >= CONFIG.SEARCH_MAX_RESULTS) break;
    }
  }
  return results;
}

// ── Accessors ──────────────────────────────────────────────────────────────────

export function getAll() { return allSatellites; }
export function getByName(name) { return allSatellites.find(s => s.name === name); }
export function getCount() { return allSatellites.length; }

// Category counts for filter chips
export function getCategoryCounts() {
  const counts = { all: allSatellites.length };
  for (const sat of allSatellites) {
    counts[sat.category] = (counts[sat.category] || 0) + 1;
  }
  return counts;
}
