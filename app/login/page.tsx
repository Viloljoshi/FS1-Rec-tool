'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, LogIn } from 'lucide-react';

const DEMO_CREDS: Record<string, { password: string; role: string }> = {
  'analyst@demo.co': { password: 'ReconAI-Demo-2026!', role: 'Analyst — exception management' },
  'manager@demo.co': { password: 'ReconAI-Demo-2026!', role: 'Manager — dashboard + evals' },
  'auditor@demo.co': { password: 'ReconAI-Demo-2026!', role: 'Auditor — read-only audit' }
};

export default function LoginPage() {
  const [email, setEmail] = useState('analyst@demo.co');
  const [password, setPassword] = useState('ReconAI-Demo-2026!');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Signed in');
    router.push('/');
    router.refresh();
  };

  const quickLogin = (targetEmail: string) => {
    setEmail(targetEmail);
    setPassword(DEMO_CREDS[targetEmail]!.password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md border-slate-200 shadow-sm">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-slate-900 grid place-items-center text-white font-mono text-sm">R</div>
            <div>
              <CardTitle className="text-xl">ReconAI</CardTitle>
              <CardDescription className="text-xs">AI-native trade reconciliation</CardDescription>
            </div>
          </div>
        </CardHeader>
        <form onSubmit={signIn}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><LogIn className="h-4 w-4 mr-2" />Sign in</>}
            </Button>
            <div className="w-full border-t border-slate-200 pt-3">
              <p className="text-xs text-slate-500 mb-2">Demo accounts:</p>
              <div className="grid gap-1.5">
                {Object.entries(DEMO_CREDS).map(([em, info]) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => quickLogin(em)}
                    className="text-left text-xs rounded border border-slate-200 px-2 py-1.5 hover:bg-slate-50 transition"
                  >
                    <span className="font-mono">{em}</span>
                    <span className="text-slate-500 ml-2">{info.role}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
