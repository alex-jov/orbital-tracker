import * as THREE from 'three';
import { GLOBE_RADIUS, EARTH_RADIUS_KM, geoTo3D, computeSpeed } from './utils.js';

// Celestrak API endpoints for different satellite categories
const CELESTRAK_GROUPS = {
  stations:  'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
  visual:    'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle',
  weather:   'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle',
  science:   'https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle',
  'gps-ops': 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle',
  starlink:  'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle',
  active:    'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
};

// Hardcoded TLE fallback for essential satellites
const FALLBACK_TLES = [
  { name: 'ISS (ZARYA)', line1: '1 25544U 98067A   24100.50000000  .00016717  00000-0  10270-3 0  9005', line2: '2 25544  51.6400 208.9163 0002526 105.8218 324.2478 15.49908950999990' },
  { name: 'HUBBLE', line1: '1 20580U 90037B   24100.50000000  .00000764  00000-0  39468-4 0  9998', line2: '2 20580  28.4699 135.4567 0002495 105.7823  32.3547 15.09429891000018' },
  { name: 'TIANGONG', line1: '1 48274U 21035A   24100.50000000  .00020000  00000-0  22440-3 0  9990', line2: '2 48274  41.4700 150.2345 0004500  30.1234 330.0123 15.62000000000010' },
  { name: 'NOAA 19', line1: '1 33591U 09005A   24100.50000000  .00000072  00000-0  63298-4 0  9998', line2: '2 33591  99.1690 120.4567 0014081 105.9560 254.3214 14.12384455000012' },
  { name: 'GPS BIIR-2', line1: '1 28474U 04045A   24100.50000000  .00000010  00000-0  10000-3 0  9998', line2: '2 28474  55.2300  45.6000 0070000  40.0000 320.5000  2.00563000000010' },
];

// Uniform orange for all satellites
const SAT_COLOR = 0xfbb96a;

// All satellites
const allSatellites = [];
// Category lookup: name => category
const categoryMap = new Map();
// Active filter
let activeCategory = 'all';

// Shared geometry and material for satellite points (instanced rendering for performance)
let pointsMesh = null;
let pointsGeo = null;
let positionsAttr = null;
let colorsAttr = null;
let sizesAttr = null;
const MAX_SATS = 30000;

// Selected satellite orbit path
let selectedOrbitLine = null;
// Hover ring sprite
let hoverRing = null;
// Label sprites for nearby satellites
const labelSprites = new Map();

export function initRenderer(scene) {
  // Use a single Points mesh for ALL satellites (huge perf win)
  pointsGeo = new THREE.BufferGeometry();
  positionsAttr = new THREE.Float32BufferAttribute(new Float32Array(MAX_SATS * 3), 3);
  colorsAttr = new THREE.Float32BufferAttribute(new Float32Array(MAX_SATS * 3), 3);
  sizesAttr = new THREE.Float32BufferAttribute(new Float32Array(MAX_SATS), 1);
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

  // Hover ring — white circle outline that follows hovered satellite
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
  hoverRing.scale.set(2.5, 2.5, 1);
  hoverRing.visible = false;
  scene.add(hoverRing);

  // Orbit path line for selected satellite
  const orbitGeo = new THREE.BufferGeometry();
  const orbitMat = new THREE.LineBasicMaterial({
    color: 0x4facfe,
    transparent: true,
    opacity: 0.4,
  });
  selectedOrbitLine = new THREE.Line(orbitGeo, orbitMat);
  selectedOrbitLine.frustumCulled = false;
  scene.add(selectedOrbitLine);
}

// Parse TLE text into satellite records
function parseTLEText(text, category) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const results = [];

  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];

    // Basic validation
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      // Try to recover: maybe name is missing
      if (lines[i].startsWith('1 ') && lines[i + 1].startsWith('2 ')) {
        i -= 1; // step back
        continue;
      }
      continue;
    }

    try {
      const satrec = satellite.twoline2satrec(line1, line2);
      if (satrec.error === 0) {
        results.push({ name: name.replace(/^\d+\s+/, '').trim() || name, satrec, category });
      }
    } catch (e) {
      // Skip invalid TLEs
    }
  }
  return results;
}

// Fetch satellite data from Celestrak
export async function fetchSatellites(groupsToFetch = ['stations', 'visual', 'weather', 'science', 'gps-ops']) {
  const results = [];
  const fetches = groupsToFetch.map(async (group) => {
    try {
      const resp = await fetch(CELESTRAK_GROUPS[group]);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const parsed = parseTLEText(text, group);
      results.push(...parsed);
      console.log(`Fetched ${parsed.length} satellites from ${group}`);
    } catch (e) {
      console.warn(`Failed to fetch ${group}:`, e.message);
    }
  });

  await Promise.allSettled(fetches);

  // If we got nothing, use fallbacks
  if (results.length === 0) {
    console.log('Using fallback TLE data');
    for (const f of FALLBACK_TLES) {
      try {
        const satrec = satellite.twoline2satrec(f.line1, f.line2);
        results.push({ name: f.name, satrec, category: 'fallback' });
      } catch (e) { /* skip */ }
    }
  }

  // Sort so specific groups come before 'active' — dedup keeps first, preserving specific categories
  results.sort((a, b) => {
    if (a.category === 'active' && b.category !== 'active') return 1;
    if (a.category !== 'active' && b.category === 'active') return -1;
    return 0;
  });

  // Deduplicate by NORAD ID
  const seen = new Set();
  for (const sat of results) {
    const noradId = sat.satrec.satnum;
    if (seen.has(noradId)) continue;
    seen.add(noradId);
    categoryMap.set(sat.name, sat.category);

    const color = new THREE.Color(SAT_COLOR);
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

  // Update buffer sizes
  pointsGeo.setDrawRange(0, allSatellites.length);

  // Set initial colors and sizes
  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    colorsAttr.setXYZ(i, sat.color.r, sat.color.g, sat.color.b);
    sizesAttr.setX(i, sat.name.includes('ISS') ? 4.0 : 2.5);
  }
  colorsAttr.needsUpdate = true;
  sizesAttr.needsUpdate = true;

  return allSatellites.length;
}

// Update all satellite positions for the given Date
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

    // ECI to geodetic
    const geodetic = satellite.eciToGeodetic(eci, gmst);
    sat.geodetic.lat = satellite.degreesLat(geodetic.latitude);
    sat.geodetic.lon = satellite.degreesLong(geodetic.longitude);
    sat.geodetic.alt = geodetic.height;
    sat.speed = computeSpeed(vel);

    // Convert to 3D
    const pos = geoTo3D(sat.geodetic.lat, sat.geodetic.lon, sat.geodetic.alt);
    sat.position.copy(pos);

    // Update buffer — only show if passes current filter
    const show = activeCategory === 'all' || sat.category === activeCategory;
    if (show) {
      positionsAttr.setXYZ(i, pos.x, pos.y, pos.z);
    } else {
      positionsAttr.setXYZ(i, 0, 0, 0);
    }
  }

  positionsAttr.needsUpdate = true;
}

// Filter satellites by category — hides non-matching completely
export function filterByCategory(category) {
  activeCategory = category;
  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    const show = category === 'all' || sat.category === category;
    sizesAttr.setX(i, show ? 2.5 : 0.0);
    if (!show) {
      positionsAttr.setXYZ(i, 0, 0, 0);
    } else {
      positionsAttr.setXYZ(i, sat.position.x, sat.position.y, sat.position.z);
    }
  }
  sizesAttr.needsUpdate = true;
  positionsAttr.needsUpdate = true;
}

export function getVisibleCount() {
  if (activeCategory === 'all') return allSatellites.length;
  return allSatellites.filter(s => s.category === activeCategory).length;
}

// Highlight selected satellite (make it bigger)
export function highlightSatellite(name) {
  for (let i = 0; i < allSatellites.length; i++) {
    const sat = allSatellites[i];
    const catVisible = activeCategory === 'all' || sat.category === activeCategory;
    if (!catVisible) { sizesAttr.setX(i, 0.0); continue; }
    sizesAttr.setX(i, sat.name === name ? 5.0 : 2.5);
  }
  sizesAttr.needsUpdate = true;
}

// Compute and display orbit path for a single satellite
export function showOrbitPath(name, baseDate) {
  const sat = getByName(name);
  if (!sat) {
    selectedOrbitLine.geometry.setDrawRange(0, 0);
    return;
  }

  selectedOrbitLine.material.color.copy(sat.color);

  const period = (2 * Math.PI) / sat.satrec.no; // minutes
  const steps = 300;
  const stepMin = period / steps;
  const positions = [];

  for (let i = 0; i <= steps; i++) {
    const t = new Date(baseDate.getTime() + i * stepMin * 60000);
    const posVel = satellite.propagate(sat.satrec, t);
    if (!posVel.position || posVel.position === false) continue;
    const gmst = satellite.gstime(t);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    const lat = satellite.degreesLat(geo.latitude);
    const lon = satellite.degreesLong(geo.longitude);
    const alt = geo.height;
    const p = geoTo3D(lat, lon, alt);
    positions.push(p.x, p.y, p.z);
  }

  const buf = new THREE.Float32BufferAttribute(positions, 3);
  selectedOrbitLine.geometry.setAttribute('position', buf);
  selectedOrbitLine.geometry.setDrawRange(0, positions.length / 3);
}

export function hideOrbitPath() {
  selectedOrbitLine.geometry.setDrawRange(0, 0);
}

// Find satellite closest to a ray (for click picking)
export function pickSatellite(raycaster, camera) {
  const ray = raycaster.ray;
  let bestDist = Infinity;
  let bestSat = null;
  const threshold = 3.0; // world units

  for (const sat of allSatellites) {
    if (sat.position.lengthSq() === 0) continue;
    const dist = ray.distanceToPoint(sat.position);
    if (dist < threshold && dist < bestDist) {
      bestDist = dist;
      bestSat = sat;
    }
  }
  return bestSat;
}

// Show hover ring on a satellite
export function setHover(sat) {
  if (!hoverRing) return;
  if (sat) {
    hoverRing.position.copy(sat.position);
    hoverRing.visible = true;
  } else {
    hoverRing.visible = false;
  }
}

// Update labels — show names for satellites visible from camera
export function updateLabels(camera, scene) {
  const camPos = camera.position;
  const camDist = camPos.length();
  // Show labels when zoomed in (closer than 3.5x globe radius)
  const showLabels = camDist < GLOBE_RADIUS * 3.5;

  if (!showLabels) {
    for (const [, sprite] of labelSprites) sprite.visible = false;
    return;
  }

  // Score all visible satellites by distance to camera, pick closest N
  const camDir = camPos.clone().normalize();
  const candidates = [];

  for (const sat of allSatellites) {
    if (sat.position.lengthSq() === 0) continue;
    // Must be on the camera-facing hemisphere
    const satDir = sat.position.clone().normalize();
    if (satDir.dot(camDir) < 0.2) continue;
    const dist = camPos.distanceTo(sat.position);
    candidates.push({ sat, dist });
  }

  // Sort by distance, take closest
  candidates.sort((a, b) => a.dist - b.dist);
  // More labels when zoomed closer
  const maxLabels = camDist < GLOBE_RADIUS * 1.8 ? 60 : camDist < GLOBE_RADIUS * 2.5 ? 40 : 20;
  const toShow = new Set(candidates.slice(0, maxLabels).map(c => c.sat.name));

  // Hide labels not in toShow
  for (const [name, sprite] of labelSprites) {
    sprite.visible = toShow.has(name);
  }

  // Show / create labels
  for (const { sat } of candidates.slice(0, maxLabels)) {
    const offset = sat.position.clone().normalize().multiplyScalar(1.5);
    let sprite = labelSprites.get(sat.name);
    if (sprite) {
      sprite.position.copy(sat.position).add(offset);
      sprite.visible = true;
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 48;
      const ctx = canvas.getContext('2d');
      ctx.font = '500 22px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'left';
      ctx.fillText(sat.name, 4, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      sprite = new THREE.Sprite(mat);
      sprite.scale.set(10, 1.2, 1);
      sprite.position.copy(sat.position).add(offset);
      sprite.center.set(0, 0.5);
      scene.add(sprite);
      labelSprites.set(sat.name, sprite);
    }
  }
}

export function getAll() { return allSatellites; }
export function getByName(name) { return allSatellites.find(s => s.name === name); }
export function getCategories() { return Object.keys(CELESTRAK_GROUPS); }
export function getCategoryMap() { return categoryMap; }
export function getCount() { return allSatellites.length; }
