/**
 * OAuth callback handler for Supabase Auth (Google, etc.)
 *
 * Critical: session cookies must be set on the SAME response object that is
 * returned. Creating a second NextResponse at the end loses the cookies and
 * the middleware sees no session → redirect loop to /login.
 *
 * Fix: create one response at the top, set cookies on it, then update its
 * Location header before returning — preserving the session.
 *
 * After migration 012 the auth trigger (handle_new_auth_user) fires on
 * auth.users INSERT and auto-links pre-synced public.users by email, so we
 * no longer need to manually match/update IDs here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

const APPROVED_DOMAINS = ['suno.com.br', 'statusinvest.com', 'gmail.com'];

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

  // After migration 012 the auth trigger already handled:
  //   1. Linking auth_id on a pre-synced public.users row (matched by email)
  //   2. Creating a basic employee row if no match was found
  // We just query by auth_id to get the role for routing.
  const serviceClient = createServiceClient();
  const { data: publicUser } = await serviceClient
    .from('users')
    .select('role, status')
    .eq('id', user.id)
    .maybeSingle();

  // Safety net: if somehow the trigger didn't fire (e.g. migration not applied yet),
  // insert a basic row manually.
  if (!publicUser) {
    console.warn('[auth/callback] no public.users row found for id', user.id, '— inserting fallback');
    await serviceClient.from('users').insert({
      id:        user.id,
      email:     user.email ?? '',
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? (user.email ?? '').split('@')[0],
      role:      'employee',
      status:    'active',
    });
  }

  // Fetch final role (may have just been inserted above)
  const { data: finalUser } = await serviceClient
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = finalUser?.role ?? 'employee';
  const destination = role === 'admin' ? '/admin/backoffice' : '/';

  // Update the Location on the SAME response (preserves session cookies)
  response.headers.set('location', `${origin}${destination}`);
  return response;
}
