import { AppShell } from '@/components/layout/AppShell';
import { OnboardingClient } from './OnboardingClient';
import { supabaseServer } from '@/lib/supabase/server';

export default async function OnboardingPage() {
  const sb = await supabaseServer();
  const { data: feeds } = await sb
    .from('feed_profiles')
    .select('id, name, kind, version, created_at, retired_at')
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">Feed Onboarding</h1>
          <p className="text-sm text-slate-500 mt-1">
            Upload a sample file, let AI propose a canonical mapping, edit as needed, and save a versioned feed profile.
          </p>
        </div>
        <OnboardingClient existingFeeds={feeds ?? []} />
      </div>
    </AppShell>
  );
}
