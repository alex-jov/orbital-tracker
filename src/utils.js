import * as THREE from 'three';

// ── Configuration ──────────────────────────────────────────────────────────────
// All magic numbers extracted into a single config object for maintainability.

export const CONFIG = {
  // Globe geometry
  EARTH_RADIUS_KM: 6371,
  GLOBE_RADIUS: 100,

  // Camera
  CAMERA_FOV: 45,
  CAMERA_NEAR: 0.1,
  CAMERA_FAR: 100000,
  CAMERA_INIT_POS: { x: 0, y: 50, z: 300 },
  CAMERA_MIN_DIST_MULT: 1.15,
  CAMERA_MAX_DIST_MULT: 8,
  CAMERA_FLY_DURATION: 1200,

  // Controls
  ROTATE_SPEED: 0.5,
  ZOOM_SPEED: 0.8,
  DAMPING_FACTOR: 0.05,

  // Satellites rendering
  MAX_SATS: 30000,
  SAT_COLOR: 0xfbb96a,
  SAT_SIZE_DEFAULT: 2.5,
  SAT_SIZE_HIGHLIGHTED: 5.0,
  SAT_SIZE_ISS: 4.0,
  SAT_SIZE_HIDDEN: 0.0,

  // Picking
  PICK_THRESHOLD: 3.0,
  PICK_THROTTLE_MS: 50,

  // Labels
  LABEL_ZOOM_THRESHOLD_MULT: 3.5,
  LABEL_MAX_CLOSE: 60,
  LABEL_MAX_MID: 40,
  LABEL_MAX_FAR: 20,
  LABEL_CLOSE_DIST_MULT: 1.8,
  LABEL_MID_DIST_MULT: 2.5,
  LABEL_DOT_THRESHOLD: 0.2,
  LABEL_POOL_SIZE: 80,

  // Orbit path
  ORBIT_STEPS: 300,
  ORBIT_COLOR: 0x4facfe,
  ORBIT_OPACITY: 0.4,

  // Hover ring
  HOVER_RING_SIZE: 2.5,

  // User marker
  USER_MARKER_COLOR: 0x34d399,
  USER_LINE_VISIBLE_COLOR: 0x34d399,
  USER_LINE_HIDDEN_COLOR: 0xf87171,

  // Timing (in ms between updates)
  UPDATE_POSITIONS_MS: 1000,
  UPDATE_TELEMETRY_MS: 160,
  UPDATE_LABELS_MS: 200,
  TLE_REFRESH_MS: 2 * 60 * 60 * 1000,

  // Fetch
  FETCH_TIMEOUT_MS: 15000,
  FETCH_RETRY_COUNT: 2,
  FETCH_RETRY_DELAY_MS: 2000,

  // Atmosphere
  ATMO_RADIUS_MULT: 1.008,

  // Stars
  STAR_COUNT: 10000,
  STAR_MIN_RADIUS: 5000,
  STAR_RADIUS_RANGE: 40000,
  STAR_SIZE: 15,
  STAR_OPACITY: 0.85,

  // Space background
  SPACE_SPHERE_RADIUS: 50000,
  SPACE_BG_COLOR: 0x000005,

  // Lighting
  SUN_INTENSITY: 2.0,
  SUN_POSITION: { x: 500, y: 200, z: 500 },
  AMBIENT_COLOR: 0x223355,
  AMBIENT_INTENSITY: 0.6,
  HEMI_SKY_COLOR: 0x4488ff,
  HEMI_GROUND_COLOR: 0x002244,
  HEMI_INTENSITY: 0.3,

  // Search
  SEARCH_MAX_RESULTS: 50,
  SEARCH_DEBOUNCE_MS: 150,

  // Persistence keys
  STORAGE_KEY_SELECTED: 'ot_selected_sat',
  STORAGE_KEY_CATEGORY: 'ot_category',
  STORAGE_KEY_CAMERA: 'ot_camera',

  // Category colors (distinct per group)
  CATEGORY_COLORS: {
    stations:  0xff6b6b, // red
    starlink:  0x4ecdc4, // teal
    visual:    0xffe66d, // yellow
    weather:   0x74b9ff, // light blue
    science:   0xa29bfe, // purple
    'gps-ops': 0xfd79a8, // pink
    active:    0xfbb96a, // orange (default)
  },

  // Ground track
  GROUND_TRACK_STEPS: 200,
  GROUND_TRACK_OPACITY: 0.3,
  GROUND_TRACK_COLOR: 0x4facfe,

  // Next pass prediction
  NEXT_PASS_MAX_HOURS: 24,
  NEXT_PASS_STEP_SEC: 30,

  // Orbit altitude regimes (km)
  ORBIT_REGIMES: {
    LEO: { min: 0, max: 2000, label: 'LEO' },
    MEO: { min: 2000, max: 35786, label: 'MEO' },
    GEO: { min: 35786, max: 100000, label: 'GEO' },
  },

  // Celestrak groups and labels
  SATELLITE_GROUPS: {
    stations:  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',  label: 'Stations' },
    starlink:  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle',  label: 'Starlink' },
    visual:    { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle',    label: 'Brightest' },
    weather:   { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle',   label: 'Weather' },
    science:   { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle',   label: 'Science' },
    'gps-ops': { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle',   label: 'GPS' },
    active:    { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',    label: 'Other' },
  },
};

// Derived constants
export const GLOBE_RADIUS = CONFIG.GLOBE_RADIUS;
export const EARTH_RADIUS_KM = CONFIG.EARTH_RADIUS_KM;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const KM_PER_UNIT = EARTH_RADIUS_KM / GLOBE_RADIUS;

// ── Coordinate conversions ─────────────────────────────────────────────────────

export function geoTo3D(latDeg, lonDeg, altKm = 0) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const r = GLOBE_RADIUS + (altKm / EARTH_RADIUS_KM) * GLOBE_RADIUS;
  return new THREE.Vector3(
    -r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    r * Math.cos(lat) * Math.sin(lon)
  );
}

export function geoToSurface(latDeg, lonDeg) {
  return geoTo3D(latDeg, lonDeg, 0);
}

// ── Look angles & visibility ────────────────────────────────────────────────────

export function computeLookAngles(observerLat, observerLon, observerAltKm, satEci, gmst) {
  const observerGd = {
    latitude: observerLat * DEG2RAD,
    longitude: observerLon * DEG2RAD,
    height: observerAltKm,
  };
  const posEcf = satellite.eciToEcf(satEci, gmst);
  const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);
  return {
    elevation: lookAngles.elevation * RAD2DEG,
    azimuth: lookAngles.azimuth * RAD2DEG,
    rangeSat: lookAngles.rangeSat,
  };
}

export function isVisible(observerLat, observerLon, observerAltKm, satEci, gmst) {
  const angles = computeLookAngles(observerLat, observerLon, observerAltKm, satEci, gmst);
  return {
    visible: angles.elevation > 0,
    elevation: angles.elevation,
    distance: angles.rangeSat,
  };
}

export function computeSpeed(velocity) {
  return Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      return fn(...args);
    }
  };
}

export function fetchWithTimeout(url, timeoutMs = CONFIG.FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function fetchWithRetry(url, retries = CONFIG.FETCH_RETRY_COUNT, delayMs = CONFIG.FETCH_RETRY_DELAY_MS) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetchWithTimeout(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

export function checkWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function formatCoord(deg, posLabel, negLabel) {
  const abs = Math.abs(deg).toFixed(4);
  return `${abs}\u00B0 ${deg >= 0 ? posLabel : negLabel}`;
}

export function formatAlt(km) {
  return km.toFixed(1) + ' km';
}

export function formatSpeed(kmPerSec) {
  return (kmPerSec * 3600).toFixed(0) + ' km/h';
}

// ── Sun position ────────────────────────────────────────────────────────────────
// Approximate sun direction in ECI-like frame for a given date.
// Based on simplified solar position algorithm (accuracy ~1 degree).

export function getSunDirection(date) {
  const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  const d = (date.getTime() - J2000) / 86400000; // days since J2000

  // Mean longitude and anomaly (degrees)
  const L = (280.460 + 0.9856474 * d) % 360;
  const g = ((357.528 + 0.9856003 * d) % 360) * DEG2RAD;

  // Ecliptic longitude
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG2RAD;

  // Obliquity of ecliptic
  const epsilon = 23.439 * DEG2RAD;

  // Sun direction in equatorial coordinates
  const x = Math.cos(lambda);
  const y = Math.cos(epsilon) * Math.sin(lambda);
  const z = Math.sin(epsilon) * Math.sin(lambda);

  return new THREE.Vector3(x, z, -y).normalize();
}

// ── Next pass prediction ────────────────────────────────────────────────────────
// Brute-force search for next time satellite crosses above horizon from observer.

export function computeNextPass(satrec, observerLat, observerLon, observerAltKm, startDate) {
  const maxMs = CONFIG.NEXT_PASS_MAX_HOURS * 3600 * 1000;
  const stepMs = CONFIG.NEXT_PASS_STEP_SEC * 1000;
  let wasAbove = false;

  for (let dt = 0; dt < maxMs; dt += stepMs) {
    const t = new Date(startDate.getTime() + dt);
    const posVel = satellite.propagate(satrec, t);
    if (!posVel.position || posVel.position === false) continue;
    const gmst = satellite.gstime(t);
    const angles = computeLookAngles(observerLat, observerLon, observerAltKm, posVel.position, gmst);
    const above = angles.elevation > 0;

    if (above && !wasAbove && dt > 0) {
      // Found a rise — refine with smaller steps
      let riseTime = t;
      for (let fine = -stepMs; fine < 0; fine += 1000) {
        const tf = new Date(t.getTime() + fine);
        const pv = satellite.propagate(satrec, tf);
        if (!pv.position || pv.position === false) continue;
        const gm = satellite.gstime(tf);
        const a = computeLookAngles(observerLat, observerLon, observerAltKm, pv.position, gm);
        if (a.elevation <= 0) { riseTime = new Date(tf.getTime() + 1000); break; }
      }
      return riseTime;
    }
    wasAbove = above;
  }
  return null;
}

export function formatRelativeTime(futureDate, now) {
  const diffMs = futureDate.getTime() - now.getTime();
  if (diffMs < 0) return 'now';
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours > 0) return `${hours}h ${remMins}m`;
  return `${mins}m`;
}

// ── Orbit regime classification ─────────────────────────────────────────────────

export function getOrbitRegime(altKm) {
  for (const [, regime] of Object.entries(CONFIG.ORBIT_REGIMES)) {
    if (altKm >= regime.min && altKm < regime.max) return regime.label;
  }
  return 'OTHER';
}
