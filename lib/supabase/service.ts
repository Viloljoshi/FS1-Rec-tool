import { createClient } from '@supabase/supabase-js';
import { createNoopSupabaseClient } from './fallback';

export function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return createNoopSupabaseClient();
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
