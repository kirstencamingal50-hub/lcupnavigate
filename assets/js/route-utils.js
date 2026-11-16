function sameId(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}

/** Resolve one saved route in either endpoint direction. */
export function getSavedRouteDirection(route, startLocation, endLocation) {
  if (!route || !startLocation || !endLocation) return null;
  const forward =
    (sameId(route.start_marker_id, startLocation.markerId) && sameId(route.destination_marker_id, endLocation.markerId)) ||
    (sameId(route.start_location_id, startLocation.id) && sameId(route.destination_location_id, endLocation.id));
  const reverse =
    (sameId(route.start_marker_id, endLocation.markerId) && sameId(route.destination_marker_id, startLocation.markerId)) ||
    (sameId(route.start_location_id, endLocation.id) && sameId(route.destination_location_id, startLocation.id));
  if (forward) return 'forward';
  if (reverse) return 'reverse';
  return null;
}
