/**
 * OAuth callback handler for Supabase Auth (Google, etc.)
 *
 * Critical: session cookies must be set on the SAME response object that is
 * returned. Creating a second NextResponse at the end loses the cookies and
 * the middleware sees no session → redirect loop to /login.
 *
 * Fix: create one response at the top, set cookies on it, then update its
 * Location header before returning — preserving the session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

const APPROVED_DOMAINS = ['suno.com.br', 'statusinvest.com'];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  // Create the response that will carry session cookies.
  // We'll update its Location later once we know the destination.
  const response = NextResponse.redirect(`${origin}/`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Write to BOTH the request (for this handler) and response (for the browser)
          request.cookies.set({ name, value, ...options });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
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
  const domain = (user.email ?? '').split('@')[1] ?? '';
  if (!APPROVED_DOMAINS.includes(domain)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
  }

  // Ensure public.users row exists and is active
  const serviceClient = createServiceClient();
  const { data: publicUser } = await serviceClient
    .from('users')
    .select('id, role, status, email')
    .eq('id', user.id)
    .maybeSingle();

  if (!publicUser) {
    // Fallback: trigger may have missed it, or user's Google email differs from
    // a pre-registered email. Check by email too.
    const { data: byEmail } = await serviceClient
      .from('users')
      .select('id, role, status')
      .eq('email', user.email ?? '')
      .maybeSingle();

    if (byEmail) {
      // Pre-registered user whose auth id now differs — update the id
      await serviceClient
        .from('users')
        .update({ id: user.id, status: 'active', updated_at: new Date().toISOString() })
        .eq('email', user.email ?? '');
    } else {
      // Brand new user — create basic employee row
      await serviceClient.from('users').insert({
        id:        user.id,
        email:     user.email ?? '',
        full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? (user.email ?? '').split('@')[0],
        role:      'employee',
        status:    'active',
      });
    }
  } else if (publicUser.status === 'pending') {
    // Pre-registered user logging in for the first time
    await serviceClient
      .from('users')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', user.id);
  }

  // Fetch final role for routing
  const { data: finalUser } = await serviceClient
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = finalUser?.role ?? 'employee';
  const destination = role === 'admin' ? '/admin/backoffice' : '/';

  // Update the Location on the SAME response (preserves session cookies)
  response.headers.set('location', `${origin}${destination}`);
  return response;
}
