export type ExternalNavigator = (url: string) => void;

const coordinates = (latitude: number, longitude: number) =>
  encodeURIComponent(`${latitude},${longitude}`);

export const googleMapsUrl = (latitude: number, longitude: number) =>
  `https://www.google.com/maps/search/?api=1&query=${coordinates(latitude, longitude)}`;

export const appleMapsUrl = (latitude: number, longitude: number) =>
  `https://maps.apple.com/?daddr=${coordinates(latitude, longitude)}`;

export const googleEarthUrl = (latitude: number, longitude: number) =>
  `https://earth.google.com/web/search/${coordinates(latitude, longitude)}`;

/**
 * Close the app overlay before handing off to the external maps app. Using
 * the current window is intentional: iOS leaves an empty Safari sheet behind
 * when a `_blank` window launches Google Maps, which appears as a white page
 * with a corner close button when the user returns to Survey Route.
 */
export function launchExternalNavigation(
  url: string,
  onClose: () => void,
  navigate: ExternalNavigator = (nextUrl) => window.location.assign(nextUrl),
) {
  onClose();
  navigate(url);
}
