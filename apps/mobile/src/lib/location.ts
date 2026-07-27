/**
 * Location, used for exactly one thing: offering check-in when a member is at
 * the meeting point.
 *
 * Foreground only, requested at the moment of use rather than at launch, and
 * never persisted on the device. App Spec §12 recommends scoping live tracking
 * to foreground-only precisely to avoid the Play Store's prominent-disclosure
 * requirement for background location, and Phase 1 has no reason to go further.
 */

import * as Location from 'expo-location';
import { Platform } from 'react-native';

export type Fix = {
  latitude: number;
  longitude: number;
  /** Metres of uncertainty as reported by the OS. The server uses this to
   *  avoid rejecting someone who is present but has a poor fix. */
  accuracy: number | null;
  capturedAt: string;
};

export type LocationOutcome =
  | { ok: true; fix: Fix }
  | { ok: false; reason: 'denied' | 'services-off' | 'unavailable'; message: string };

/**
 * Development escape hatch.
 *
 * Testing a geofence otherwise means physically standing at the meeting point.
 * Gated on __DEV__ as well as the env var, so it cannot be switched on in a
 * release build even by shipping the wrong .env.
 */
function devOverride(): Fix | null {
  if (!__DEV__) return null;
  const raw = process.env.EXPO_PUBLIC_DEV_FAKE_LOCATION;
  if (!raw || raw === 'false') return null;

  const [lat, lng] = raw.split(',').map((n: string) => Number(n.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { latitude: lat!, longitude: lng!, accuracy: 5, capturedAt: new Date().toISOString() };
}

export async function getCurrentFix(): Promise<LocationOutcome> {
  const fake = devOverride();
  if (fake) return { ok: true, fix: fake };

  // Web has no expo-location native module; the browser API is enough for the
  // development harness but this is not a shipped surface.
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            ok: true,
            fix: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
              capturedAt: new Date().toISOString(),
            },
          }),
        () =>
          resolve({
            ok: false,
            reason: 'denied',
            message: 'Location permission was declined.',
          }),
      );
    });
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return {
      ok: false,
      reason: 'denied',
      // Deliberately not a dead end: an organiser can always check someone in
      // by hand (ADR 0002 §3), and the member should know that.
      message: 'MVMNT needs location to check you in. You can still ask an organiser to check you in.',
    };
  }

  const servicesOn = await Location.hasServicesEnabledAsync();
  if (!servicesOn) {
    return {
      ok: false,
      reason: 'services-off',
      message: 'Location services are switched off on this device.',
    };
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      ok: true,
      fix: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
        capturedAt: new Date(position.timestamp).toISOString(),
      },
    };
  } catch {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Could not get a location fix. Try again, or ask an organiser to check you in.',
    };
  }
}

/**
 * Great-circle distance in metres.
 *
 * Mirrors app_private.distance_meters() in the database. This copy exists only
 * to decide whether to *show* the check-in button; the server recomputes it and
 * makes the actual decision, so the two can never disagree in a way that
 * matters (Principles §2, §3).
 */
export function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}
