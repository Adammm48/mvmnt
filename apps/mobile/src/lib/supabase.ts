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
 * CHUNKED, because SecureStore rejects values over 2048 bytes on Android —
 * and a Supabase session (access token + refresh token + user object) is
 * routinely bigger. The earlier version of this file *named* the limit and
 * then passed the session through whole: the write failed only on Android,
 * only on device, and the symptom was a member signed out on every cold
 * start. The audit council caught it before a phone ever did.
 *
 * The value is split into <=1900-byte chunks under key.0, key.1, …, with a
 * count under the bare key. Reads reassemble; a missing chunk returns null,
 * which Supabase treats as signed-out — corrupt is worse than absent.
 */
const CHUNK = 1900;

const secureStorage = {
  getItem: async (key: string) => {
    const head = await SecureStore.getItemAsync(key);
    if (head === null) return null;
    const count = Number.parseInt(head, 10);
    // Legacy unchunked value from a build before this adapter: use it as-is.
    if (!Number.isInteger(count) || count <= 0 || count > 50) return head;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  setItem: async (key: string, value: string) => {
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.setItemAsync(key, String(count));
    // Stale higher-index chunks from a previously longer session must go, or
    // a shrink-then-grow cycle could interleave two sessions' halves.
    for (let i = count; i < count + 5; i++) {
      await SecureStore.deleteItemAsync(`${key}.${i}`);
    }
  },
  removeItem: async (key: string) => {
    const head = await SecureStore.getItemAsync(key);
    const count = Number.parseInt(head ?? '', 10);
    await SecureStore.deleteItemAsync(key);
    if (Number.isInteger(count) && count > 0 && count <= 50) {
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}.${i}`);
      }
    }
  },
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
