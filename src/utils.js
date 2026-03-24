import * as THREE from 'three';

// Constants
export const EARTH_RADIUS_KM = 6371;
export const GLOBE_RADIUS = 100; // Large globe for visual impact
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const KM_PER_UNIT = EARTH_RADIUS_KM / GLOBE_RADIUS;

// Convert geodetic (lat/lon degrees, alt km) to 3D position on globe
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

// Surface-only version
export function geoToSurface(latDeg, lonDeg) {
  return geoTo3D(latDeg, lonDeg, 0);
}

// Compute look angles from observer to satellite
export function computeLookAngles(observerLat, observerLon, observerAltKm, satEci, gmst) {
  const observerGd = {
    latitude: observerLat * DEG2RAD,
    longitude: observerLon * DEG2RAD,
    height: observerAltKm
  };
  const posEcf = satellite.eciToEcf(satEci, gmst);
  const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);
  return {
    elevation: lookAngles.elevation * RAD2DEG,
    azimuth: lookAngles.azimuth * RAD2DEG,
    rangeSat: lookAngles.rangeSat
  };
}

// Check if satellite is above horizon
export function isVisible(observerLat, observerLon, observerAltKm, satEci, gmst) {
  const angles = computeLookAngles(observerLat, observerLon, observerAltKm, satEci, gmst);
  return {
    visible: angles.elevation > 0,
    elevation: angles.elevation,
    distance: angles.rangeSat
  };
}

// Speed from velocity vector (km/s)
export function computeSpeed(velocity) {
  return Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
}
