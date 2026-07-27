/**
 * Push registration.
 *
 * The token is handed to register_push_token(), which reassigns it if the
 * device has changed owner — see ADR 0001. Registering is therefore safe to
 * call on every launch and is how a handed-down phone stops receiving the
 * previous owner's notifications.
 *
 * PHASE 1: no APNs or FCM credentials exist yet, so obtaining a real Expo token
 * will fail on a device. That is expected and must not break the app — the
 * failure is swallowed with a log, and everything else keeps working.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushRegistration =
  | { ok: true; token: string }
  | { ok: false; reason: 'simulator' | 'denied' | 'unconfigured'; message: string };

export async function registerForPush(): Promise<PushRegistration> {
  if (!Device.isDevice) {
    return {
      ok: false,
      reason: 'simulator',
      message: 'Push notifications need a physical device.',
    };
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    return {
      ok: false,
      reason: 'denied',
      message: 'Notifications are off. You can turn them on in Settings.',
    };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Run updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#FF5A36',
    });
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (error) throw error;

    return { ok: true, token };
  } catch (error) {
    // Expected until MVMNT owns an Apple Developer account and a Firebase
    // project. Logged rather than surfaced: nothing the member can act on.
    console.log('push registration unavailable (expected in Phase 1):', error);
    return {
      ok: false,
      reason: 'unconfigured',
      message: 'Push notifications are not switched on for this build yet.',
    };
  }
}
