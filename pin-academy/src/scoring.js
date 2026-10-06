// Distance is always worked out on the server. The browser never decides a score.

export function metersBetween(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Oscar's point bands from his first version, kept so practice scores feel the same to trainees.
const BANDS = [[5, 100], [15, 90], [30, 75], [60, 55], [120, 35], [250, 15]];
export function points(meters) {
  for (const [max, pts] of BANDS) if (meters <= max) return pts;
  return 0;
}

export function tier(meters) {
  if (meters <= 5) return 'Spot on';
  if (meters <= 15) return 'Close';
  if (meters <= 30) return 'Near, wrong spot';
  if (meters <= 60) return 'Off';
  return 'Far off';
}

export const validLatLng = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
