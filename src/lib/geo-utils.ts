export type LngLat = { lng: number; lat: number };

export function haversineMeters(a: LngLat, b: LngLat) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(la1) * Math.cos(la2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

export function haversineKm(a: LngLat, b: LngLat) {
  return haversineMeters(a, b) / 1000;
}

export function nextStopIndex(stops: string[], completedIdx: number[]) {
  for (let i = 0; i < stops.length; i++) {
    if (!completedIdx.includes(i)) return i;
  }
  return null;
}

export function minutesBetween(aMs: number, bMs: number) {
  return Math.max(0, Math.round((bMs - aMs) / 60000));
}
