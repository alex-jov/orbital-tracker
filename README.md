# Orbital Tracker

A real-time 3D satellite tracker built with Three.js and satellite.js. Displays thousands of active satellites orbiting a realistic Earth globe with live telemetry data.

![License](https://img.shields.io/badge/license-MIT-blue)
![Satellites](https://img.shields.io/badge/satellites-10%2C000%2B-orange)
![Three.js](https://img.shields.io/badge/Three.js-r160-black)

## Features

- **Real-time tracking** of 10,000+ active satellites from [Celestrak](https://celestrak.org/)
- **3D Earth globe** with NASA Blue Marble textures, bump mapping, night lights, and atmospheric rim
- **Live telemetry panel** showing latitude, longitude, altitude, speed, and visibility status
- **Category filters** to isolate Space Stations, Starlink, GPS, Weather, Science, and more
- **Satellite hover** with selection ring and click-to-inspect
- **Zoom-adaptive labels** that reveal satellite names as you zoom in
- **Orbit path rendering** for any selected satellite (full orbital period)
- **User geolocation** with above-horizon / below-horizon visibility calculation
- **N2YO integration** for detailed satellite information pages
- **Space skybox** background with 10,000 procedural stars
- **Smooth orbit controls** with damping, zoom limits, and touch support

## Tech Stack

| Component | Technology |
|-----------|-----------|
| 3D Engine | [Three.js](https://threejs.org/) r160 (ES modules) |
| Orbital Mechanics | [satellite.js](https://github.com/shashwatak/satellite-js) v5 |
| Satellite Data | [Celestrak](https://celestrak.org/) GP/TLE API |
| Textures | NASA Blue Marble via [three-globe](https://github.com/vasturiano/three-globe) |
| Fonts | Inter + JetBrains Mono (Google Fonts) |
| Frameworks | None (vanilla JS) |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/orbital-tracker.git
cd orbital-tracker

# Serve locally (any static server works)
npx serve .
# or
python -m http.server 8000
```

Open `http://localhost:3000` (or `:8000`). The app fetches live satellite data on startup.

## Project Structure

```
orbital-tracker/
  index.html                  # Entry point, HUD layout, import maps
  style.css                   # UI styling (CSS variables, dark theme)
  src/
    main.js                   # App init, animation loop
    globe.js                  # Three.js scene, Earth mesh, atmosphere, stars
    satellites.js             # TLE fetching, propagation, GPU points, labels
    ui.js                     # Telemetry panel, filters, hover, geolocation
    utils.js                  # Coordinate math (geodetic to 3D, visibility)
  assets/
    space_bg.jpg              # Space skybox texture
    earth_textures/
      earth_daymap.jpg        # NASA Blue Marble day texture
      earth_nightmap.jpg      # City lights at night
      earth_topology.png      # Bump map for terrain relief
      earth_water.png         # Specular map for ocean reflections
```

## Data Sources

| Source | Content | Update |
|--------|---------|--------|
| Celestrak `active` | All active satellites (~10k) | On page load |
| Celestrak `stations` | ISS, Tiangong, etc. | On page load |
| Celestrak `starlink` | SpaceX Starlink constellation | On page load |
| Celestrak `weather` | Weather satellites | On page load |
| Celestrak `science` | Science missions | On page load |
| Celestrak `gps-ops` | GPS constellation | On page load |
| Celestrak `visual` | Brightest objects | On page load |

TLE data is parsed with satellite.js to compute real-time positions using SGP4 propagation.

## How It Works

1. **Fetch** TLE data from Celestrak for multiple satellite groups
2. **Parse** Two-Line Elements and create SGP4 satellite records
3. **Propagate** each satellite's position in ECI coordinates for the current time
4. **Convert** ECI to geodetic (lat/lon/alt) then to 3D cartesian on the globe
5. **Render** all satellites as a single GPU-optimized `Points` mesh with a custom shader
6. **Update** positions every second, telemetry panel every ~160ms

## Browser Support

Requires a modern browser with:
- WebGL 2.0
- ES Modules + Import Maps
- `fetch` API (for Celestrak data)

Tested on Chrome, Firefox, Edge, and Safari 16+.

## License

MIT
