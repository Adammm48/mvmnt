import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Database } from '@mvmnt/shared';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.',
  );
}

/**
 * Session storage.
 *
 * SecureStore on device: the session token is a bearer credential and belongs
 * in the keychain/keystore, not in plain AsyncStorage where any backup or
 * filesystem read can lift it.
 *
 * SecureStore has a 2048-byte limit per value and is unavailable on web, so the
 * web build falls back to localStorage — acceptable because web is a
 * development convenience here, not a shipped surface.
 */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Mobile has no URL bar to parse a session out of.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
