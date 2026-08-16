/**
 * geoUtils.js — Location validation helpers
 *
 * Used by the attendance service to confirm a student's GPS coordinates
 * are within the allowed radius of the classroom before accepting a scan.
 *
 * We use 'geolib' which implements the Vincenty formula (more accurate than
 * basic Haversine for distances < 1 km, which is our typical use case).
 */
const geolib = require('geolib');

/**
 * Check if student coordinates are within `radiusMeters` of the classroom.
 *
 * @param {object} classroomCoords  - { latitude, longitude } from QRSession
 * @param {object} studentCoords    - { latitude, longitude } from request
 * @param {number} radiusMeters     - maximum allowed distance (default: from env)
 * @returns {{ valid: boolean, distanceMeters: number }}
 */
function isWithinRadius(classroomCoords, studentCoords, radiusMeters) {
  const distanceMeters = geolib.getDistance(
    { latitude: classroomCoords.latitude, longitude: classroomCoords.longitude },
    { latitude: studentCoords.latitude,   longitude: studentCoords.longitude   }
  );

  return {
    valid: distanceMeters <= radiusMeters,
    distanceMeters,
  };
}

/**
 * Validate that coordinates are plausible (not 0,0 and within valid ranges).
 * Students sometimes send (0,0) when they deny location permission.
 */
function isValidCoordinate(lat, lng) {
  if (lat === 0 && lng === 0) return false;
  if (lat < -90  || lat > 90)  return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

module.exports = { isWithinRadius, isValidCoordinate };
