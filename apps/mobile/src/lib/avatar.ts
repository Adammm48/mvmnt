import { supabase } from './supabase';

/**
 * avatar_url holds either a full URL (the OAuth-era rows) or a storage path
 * like `avatars/<uid>/<uuid>.jpg` (self-uploaded, migration 0053-era). One
 * helper turns both into something an <Image> can load, so no renderer has
 * to know the difference.
 */
export function avatarUri(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (/^https?:\/\//.test(avatarUrl)) return avatarUrl;
  const path = avatarUrl.replace(/^avatars\//, '');
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}
