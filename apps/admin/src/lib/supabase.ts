import { createClient } from '@supabase/supabase-js';
import type { Database } from '@mvmnt/shared';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.');
}

/**
 * The admin console uses the SAME anon key as the mobile app, and holds no
 * elevated credential of its own.
 *
 * Being an admin is a property of the signed-in account (profiles.role), not of
 * the app you happen to be using — so a member who opens this console sees
 * nothing they could not already see, and every admin action is refused by the
 * RPC's own is_admin() check. The service role key must never appear here.
 */
export const supabase = createClient<Database>(url, anonKey);
