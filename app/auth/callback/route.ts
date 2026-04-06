/**
 * OAuth callback handler for Supabase Auth (Google, etc.)
 *
 * Supabase redirects here after a successful OAuth login with ?code=...
 * We exchange the code for a session, then route the user to the right page.
 *
 * Auto-provisioning of public.users is handled by the DB trigger
 * (migration 011 — handle_new_auth_user). This route only needs to:
 *   1. Exchange the code for a session
 *   2. Activate pending pre-registered users on first login
 *   3. Enforce approved email domain
 *   4. Route: admin → /admin/backoffice, others → /
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

const APPROVED_DOMAINS = ['suno.com.br', 'statusinvest.com'];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  // Build Supabase SSR client with the response cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error('[auth/callback] code exchange failed:', error?.message);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const user = data.user;

  // Enforce approved email domains
  const domain = user.email?.split('@')[1] ?? '';
  if (!APPROVED_DOMAINS.includes(domain)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
  }

  // Activate pending pre-registered users on first sign-in
  // and ensure public.users row exists (trigger handles new users, but
  // there's a small window between trigger firing and this code running)
  const serviceClient = createServiceClient();
  const { data: publicUser } = await serviceClient
    .from('users')
    .select('id, role, status')
    .eq('id', user.id)
    .maybeSingle();

  if (!publicUser) {
    // Trigger may have missed it (race condition) — create the row now
    await serviceClient.from('users').insert({
      id:         user.id,
      email:      user.email ?? '',
      full_name:  user.user_metadata?.full_name ?? user.user_metadata?.name ?? (user.email?.split('@')[0] ?? ''),
      role:       'employee',
      status:     'active',
    }).onConflict('id').ignore();
  } else if (publicUser.status === 'pending') {
    // Pre-registered user logging in for the first time
    await serviceClient
      .from('users')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', user.id);
  }

  // Fetch final role (may have been updated above)
  const { data: finalUser } = await serviceClient
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = finalUser?.role ?? 'employee';
  const destination = role === 'admin' ? '/admin/backoffice' : '/';

  return NextResponse.redirect(`${origin}${destination}`);
}
