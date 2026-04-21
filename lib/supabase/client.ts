import { createBrowserClient } from '@supabase/ssr';
import { createNoopSupabaseClient } from './fallback';

export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return createNoopSupabaseClient();
  }
  return createBrowserClient(url, anon);
}
