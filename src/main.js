import { checkWebGL, CONFIG } from './utils.js';
import * as Globe from './globe.js';
import * as Satellites from './satellites.js';
import * as UI from './ui.js';

// ── WebGL check ────────────────────────────────────────────────────────────────

if (!checkWebGL()) {
  const el = document.getElementById('loading');
  if (el) {
    el.querySelector('.loading-title').textContent = 'WebGL Required';
    el.querySelector('.loading-sub').textContent =
      'Your browser does not support WebGL. Please use a modern browser.';
    el.querySelector('.loading-ring').style.display = 'none';
  }
  throw new Error('WebGL not supported');
}

// ── Init scene ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById('globe-canvas');
let initError = false;

try {
  Globe.init(canvas);
} catch (e) {
  initError = true;
  console.error('Failed to initialize globe:', e);
}

if (!initError) {
  const scene = Globe.getScene();
  Satellites.initRenderer(scene);
  Satellites.initMultiOrbitRenderer(scene);

  const loadingText = document.getElementById('loading-text');

  // Fetch with progress reporting
  loadingText.textContent = 'Fetching satellite data...';

  Satellites.fetchSatellites(
    ['active', 'stations', 'visual', 'weather', 'science', 'gps-ops', 'starlink'],
    (fetched, total, group, count) => {
      loadingText.textContent = `Loading ${group}... (${fetched}/${total})`;
    }
  ).then((count) => {
    loadingText.textContent = `${count} satellites loaded`;

    UI.init(scene);

    Satellites.update(UI.getSimTime());

    setTimeout(() => UI.hideLoading(), 500);

    // ── Animation loop (time-based, no frameCount overflow) ────────────────

    let lastPositionUpdate = 0;
    let lastTelemetryUpdate = 0;
    let lastLabelUpdate = 0;
    let lastSunUpdate = 0;

    // Initial sun position
    Globe.updateSunPosition(UI.getSimTime());

    function animate(now) {
      requestAnimationFrame(animate);

      const simTime = UI.getSimTime();

      // Update positions at configured interval
      if (now - lastPositionUpdate >= CONFIG.UPDATE_POSITIONS_MS) {
        lastPositionUpdate = now;
        Satellites.update(simTime);
      }

      // Interpolate satellite positions every frame for smooth movement
      const t = CONFIG.UPDATE_POSITIONS_MS > 0
        ? (now - lastPositionUpdate) / CONFIG.UPDATE_POSITIONS_MS
        : 1;
      Satellites.interpolatePositions(t);

      // Update sun position every 10s (doesn't change fast)
      if (now - lastSunUpdate >= 10000) {
        lastSunUpdate = now;
        Globe.updateSunPosition(simTime);
      }

      // Update telemetry panel
      if (now - lastTelemetryUpdate >= CONFIG.UPDATE_TELEMETRY_MS) {
        lastTelemetryUpdate = now;
        UI.updatePanel();
      }

      // Update labels only when camera moves
      if (now - lastLabelUpdate >= CONFIG.UPDATE_LABELS_MS && Globe.hasCameraMoved()) {
        lastLabelUpdate = now;
        UI.updateLabels();
      }

      Globe.render();
    }

    requestAnimationFrame(animate);

    // ── Auto-refresh TLE data ──────────────────────────────────────────────

    setInterval(() => {
      console.log('Auto-refreshing TLE data...');
      Satellites.fetchSatellites(
        ['active', 'stations', 'visual', 'weather', 'science', 'gps-ops', 'starlink']
      ).then((count) => {
        console.log(`TLE refresh complete: ${count} satellites`);
        const badge = document.getElementById('sat-total-badge');
        if (badge) badge.textContent = count + ' objects';
      }).catch((e) => {
        console.warn('TLE refresh failed:', e.message);
      });
    }, CONFIG.TLE_REFRESH_MS);

  }).catch((e) => {
    console.error('Fatal: failed to load satellites', e);
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
      loadingText.textContent = 'Failed to load satellite data. Please reload.';
    }
  });
}
