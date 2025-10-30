'use client';

import { supabase } from '@/lib/supabaseClient';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace('/');
    });
    return () => { sub.data.subscription.unsubscribe(); };
  }, [router]);

  return (
    <main className="min-h-dvh grid place-items-center bg-black text-white p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
        <h1 className="text-2xl font-semibold mb-4">Sign in</h1>
        <Auth
          supabaseClient={supabase}
          appearance={{ theme: ThemeSupa }}
          providers={[]}
          view="sign_in"
          showLinks={true}
          theme="dark"
          redirectTo={typeof window !== 'undefined' ? window.location.origin : undefined}
        />
        <p className="text-xs text-zinc-400 mt-4">
          Use email + password. After signing in, you’ll be redirected to the app.
        </p>
      </div>
    </main>
  );
}
