import * as Globe from './globe.js';
import * as Satellites from './satellites.js';
import * as UI from './ui.js';

const canvas = document.getElementById('globe-canvas');
const { scene } = Globe.init(canvas);

Satellites.initRenderer(scene);

const loadingText = document.getElementById('loading-text');
loadingText.textContent = 'Fetching satellite data...';

// Fetch 'active' group = all active satellites (~10k), plus specific groups for category tagging
Satellites.fetchSatellites(['active', 'stations', 'visual', 'weather', 'science', 'gps-ops', 'starlink']).then((count) => {
  console.log(`Loaded ${count} satellites`);
  loadingText.textContent = `${count} satellites loaded`;

  UI.init(scene);

  Satellites.update(new Date());

  setTimeout(() => UI.hideLoading(), 500);

  let frameCount = 0;

  function animate() {
    requestAnimationFrame(animate);

    // Update positions every 60 frames (~1s at 60fps)
    if (frameCount % 60 === 0) {
      Satellites.update(new Date());
    }

    // Update telemetry panel every 10 frames
    if (frameCount % 10 === 0) {
      UI.updatePanel();
    }

    // Update satellite name labels based on zoom
    if (frameCount % 5 === 0) {
      UI.updateLabels();
    }

    Globe.render();
    frameCount++;
  }

  animate();
});
