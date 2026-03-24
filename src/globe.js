import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLOBE_RADIUS } from './utils.js';

let scene, camera, renderer, controls;
let earthMesh;

export function init(canvas) {
  scene = new THREE.Scene();

  // Space texture as background (loaded onto a large sphere behind everything)
  const spaceTexture = new THREE.TextureLoader().load('assets/space_bg.jpg');
  spaceTexture.colorSpace = THREE.SRGBColorSpace;
  const spaceGeo = new THREE.SphereGeometry(50000, 32, 32);
  const spaceMat = new THREE.MeshBasicMaterial({ map: spaceTexture, side: THREE.BackSide });
  scene.add(new THREE.Mesh(spaceGeo, spaceMat));
  scene.background = new THREE.Color(0x000005); // fallback while loading

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100000);
  camera.position.set(0, 50, 300);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // OrbitControls - full 360 rotation
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = GLOBE_RADIUS * 1.15;
  controls.maxDistance = GLOBE_RADIUS * 8;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.8;
  controls.enablePan = false;

  // Lighting
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
  sunLight.position.set(500, 200, 500);
  scene.add(sunLight);

  const ambientLight = new THREE.AmbientLight(0x223355, 0.6);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0x4488ff, 0x002244, 0.3);
  scene.add(hemiLight);

  createEarth();
  createAtmosphere();
  createStars();

  window.addEventListener('resize', onResize);
  return { scene, camera, renderer, controls };
}

function createEarth() {
  const loader = new THREE.TextureLoader();
  const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 128, 128);

  // Local textures downloaded from three-globe (real satellite photos)
  const dayMap = loader.load('assets/earth_textures/earth_daymap.jpg');
  const nightMap = loader.load('assets/earth_textures/earth_nightmap.jpg');
  const bumpMap = loader.load('assets/earth_textures/earth_topology.png');
  const specMap = loader.load('assets/earth_textures/earth_water.png');

  dayMap.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshPhongMaterial({
    map: dayMap,
    emissiveMap: nightMap,
    emissive: new THREE.Color(0xffddaa),
    emissiveIntensity: 0.12,
    bumpMap: bumpMap,
    bumpScale: 0.8,
    specularMap: specMap,
    specular: new THREE.Color(0x222233),
    shininess: 25,
  });

  earthMesh = new THREE.Mesh(geometry, material);
  scene.add(earthMesh);
}

function createAtmosphere() {
  // Subtle thin rim glow only
  const rimGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.008, 64, 64);
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
  const count = 10000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 5000 + Math.random() * 40000;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 15,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
  });
  scene.add(new THREE.Points(geo, mat));
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

export function render() {
  controls.update();
  renderer.render(scene, camera);
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function getControls() { return controls; }
