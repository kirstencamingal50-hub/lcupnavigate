function sameId(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}

/** Resolve one saved route in either endpoint direction. */
export function getSavedRouteDirection(route, startLocation, endLocation) {
  if (!route || !startLocation || !endLocation) return null;
  // Prefer exact directory-location endpoints whenever the saved route has
  // them. Marker IDs are shared by every room in a building, so allowing a
  // marker match to override a location mismatch can select the wrong route.
  const startLocationId = startLocation.routeLocationId ?? startLocation.id;
  const endLocationId = endLocation.routeLocationId ?? endLocation.id;
  const hasLocationEndpoints =
    route.start_location_id !== null && route.start_location_id !== undefined &&
    route.destination_location_id !== null && route.destination_location_id !== undefined;

  if (hasLocationEndpoints) {
    if (sameId(route.start_location_id, startLocationId) && sameId(route.destination_location_id, endLocationId)) return 'forward';
    if (sameId(route.start_location_id, endLocationId) && sameId(route.destination_location_id, startLocationId)) return 'reverse';
    return null;
  }

  if (sameId(route.start_marker_id, startLocation.markerId) && sameId(route.destination_marker_id, endLocation.markerId)) return 'forward';
  if (sameId(route.start_marker_id, endLocation.markerId) && sameId(route.destination_marker_id, startLocation.markerId)) return 'reverse';
  return null;
}
