import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLOBE_RADIUS, CONFIG, checkWebGL, getSunDirection } from './utils.js';

let scene, camera, renderer, controls;
let earthMesh, sunLight;
let animatingCamera = false;
let cameraAnimStart, cameraAnimDuration, cameraFrom, cameraTo;

export function init(canvas) {
  if (!checkWebGL()) {
    throw new Error('WEBGL_NOT_SUPPORTED');
  }

  scene = new THREE.Scene();

  // Space background sphere
  const spaceTexture = loadTexture('assets/space_bg.jpg');
  spaceTexture.colorSpace = THREE.SRGBColorSpace;
  const spaceGeo = new THREE.SphereGeometry(CONFIG.SPACE_SPHERE_RADIUS, 32, 32);
  const spaceMat = new THREE.MeshBasicMaterial({ map: spaceTexture, side: THREE.BackSide });
  scene.add(new THREE.Mesh(spaceGeo, spaceMat));
  scene.background = new THREE.Color(CONFIG.SPACE_BG_COLOR);

  camera = new THREE.PerspectiveCamera(
    CONFIG.CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    CONFIG.CAMERA_NEAR,
    CONFIG.CAMERA_FAR
  );
  // Zoom out more on small screens so the globe fits nicely
  const isMobile = window.innerWidth <= 600;
  const initZ = isMobile ? CONFIG.CAMERA_INIT_POS.z * 1.6 : CONFIG.CAMERA_INIT_POS.z;
  camera.position.set(CONFIG.CAMERA_INIT_POS.x, CONFIG.CAMERA_INIT_POS.y * (isMobile ? 0.3 : 1), initZ);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = CONFIG.DAMPING_FACTOR;
  controls.minDistance = GLOBE_RADIUS * CONFIG.CAMERA_MIN_DIST_MULT;
  controls.maxDistance = GLOBE_RADIUS * CONFIG.CAMERA_MAX_DIST_MULT;
  controls.rotateSpeed = CONFIG.ROTATE_SPEED;
  controls.zoomSpeed = CONFIG.ZOOM_SPEED;
  controls.enablePan = false;

  // Lighting — sun direction will be updated each frame to match real position
  sunLight = new THREE.DirectionalLight(0xffffff, CONFIG.SUN_INTENSITY);
  sunLight.position.set(CONFIG.SUN_POSITION.x, CONFIG.SUN_POSITION.y, CONFIG.SUN_POSITION.z);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(CONFIG.AMBIENT_COLOR, CONFIG.AMBIENT_INTENSITY));
  scene.add(new THREE.HemisphereLight(CONFIG.HEMI_SKY_COLOR, CONFIG.HEMI_GROUND_COLOR, CONFIG.HEMI_INTENSITY));

  createEarth();
  createAtmosphere();
  createStars();

  window.addEventListener('resize', onResize);
  return { scene, camera, renderer, controls };
}

function loadTexture(path) {
  const loader = new THREE.TextureLoader();
  return loader.load(
    path,
    undefined,
    undefined,
    (err) => console.warn(`Failed to load texture: ${path}`, err)
  );
}

function createEarth() {
  const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 128, 128);

  const dayMap = loadTexture('assets/earth_textures/earth_daymap.jpg');
  const nightMap = loadTexture('assets/earth_textures/earth_nightmap.jpg');
  const bumpMap = loadTexture('assets/earth_textures/earth_topology.png');
  const specMap = loadTexture('assets/earth_textures/earth_water.png');
  dayMap.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshPhongMaterial({
    map: dayMap,
    emissiveMap: nightMap,
    emissive: new THREE.Color(0xffddaa),
    emissiveIntensity: 0.12,
    bumpMap,
    bumpScale: 0.8,
    specularMap: specMap,
    specular: new THREE.Color(0x222233),
    shininess: 25,
  });

  earthMesh = new THREE.Mesh(geometry, material);
  scene.add(earthMesh);
}

function createAtmosphere() {
  const rimGeo = new THREE.SphereGeometry(GLOBE_RADIUS * CONFIG.ATMO_RADIUS_MULT, 64, 64);
  const rimMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vec3 viewDir = normalize(-vPosition);
        float rim = 1.0 - max(dot(viewDir, vNormal), 0.0);
        float intensity = pow(rim, 5.0);
        gl_FragColor = vec4(0.25, 0.55, 1.0, intensity * 0.25);
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(rimGeo, rimMat));
}

function createStars() {
  const count = CONFIG.STAR_COUNT;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = CONFIG.STAR_MIN_RADIUS + Math.random() * CONFIG.STAR_RADIUS_RANGE;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: CONFIG.STAR_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: CONFIG.STAR_OPACITY,
  });
  scene.add(new THREE.Points(geo, mat));
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Smooth camera fly-to animation
export function flyTo(targetPos, duration = CONFIG.CAMERA_FLY_DURATION) {
  const dir = targetPos.clone().normalize();
  // Position camera looking at the target from outside
  const camDist = GLOBE_RADIUS * 2.0;
  cameraTo = dir.multiplyScalar(camDist);
  cameraFrom = camera.position.clone();
  cameraAnimStart = performance.now();
  cameraAnimDuration = duration;
  animatingCamera = true;
}

function updateCameraAnimation() {
  if (!animatingCamera) return;
  const elapsed = performance.now() - cameraAnimStart;
  const t = Math.min(elapsed / cameraAnimDuration, 1);
  // Ease in-out cubic
  const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  camera.position.lerpVectors(cameraFrom, cameraTo, ease);
  if (t >= 1) animatingCamera = false;
}

export function updateSunPosition(date) {
  if (!sunLight) return;
  const dir = getSunDirection(date);
  sunLight.position.copy(dir.multiplyScalar(500));
}

export function render() {
  updateCameraAnimation();
  controls.update();
  renderer.render(scene, camera);
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function getControls() { return controls; }

export function getCameraState() {
  return {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
    tx: controls.target.x,
    ty: controls.target.y,
    tz: controls.target.z,
  };
}

export function restoreCameraState(state) {
  if (!state) return;
  camera.position.set(state.x, state.y, state.z);
  controls.target.set(state.tx, state.ty, state.tz);
  controls.update();
}
