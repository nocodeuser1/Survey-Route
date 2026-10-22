import { Capacitor } from '@capacitor/core';

/**
 * A short confirmation buzz for gestures that have no visual "it worked yet"
 * moment of their own — the long-press that arms a column resize, for
 * instance. Uses Capacitor Haptics inside the native shells and falls back to
 * the Vibration API on the web build, where it is a no-op on iOS Safari and
 * on any device the user has muted. Never throws: a missing or denied
 * vibration motor must not break the gesture it is decorating.
 */
export async function hapticTick(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    }
    navigator.vibrate?.(10);
  } catch {
    /* no haptics available — the gesture still works */
  }
}
