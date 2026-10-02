/** Bounded, cancellable location requests. Cancellation ignores late native callbacks. */
export function requestMapLocation(
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined,
  onSuccess: (position: GeolocationPosition) => void,
  onError: (message: string) => void,
  options: PositionOptions = {},
): () => void {
  let active = true;
  const timeout = options.timeout ?? 12000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (callback: () => void) => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    callback();
  };
  const fail = (code?: number) => finish(() => onError(locationErrorMessage(code)));
  if (!geolocation) {
    finish(() => onError('Location is not available in this browser. Open the app in a browser with location access.'));
  } else {
    // Some mobile browsers never invoke either callback after suspension or a
    // dismissed permission prompt. Do not leave the control spinning forever.
    timer = setTimeout(() => fail(3), timeout);
    try {
      geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
            || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            finish(() => onError('Your device returned an invalid location. Please try again.'));
            return;
          }
          finish(() => onSuccess(position));
        },
        error => fail(error.code),
        { enableHighAccuracy: true, maximumAge: 0, ...options, timeout },
      );
    } catch {
      finish(() => onError('Location could not start. Check location access in your browser and device settings, then try again.'));
    }
  }
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

export function locationErrorMessage(code?: number): string {
  switch (code) {
    case 1:
      return 'Location access is blocked. Allow location for this site in your browser and turn on device Location Services, then try again.';
    case 2:
      return 'Your location is unavailable. Check device Location Services or move somewhere with a better signal, then try again.';
    case 3:
      return 'Finding your location took too long. Check your signal and location access, then try again.';
    default:
      return 'Unable to find your location. Please try again.';
  }
}
