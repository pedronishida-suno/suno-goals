import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  // Refresh session if expired
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // ── Protect employee dashboard (/) ────────────────────────────────────────
  if (pathname === '/' || pathname.startsWith('/manager')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // ── Protect /admin routes ─────────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    // Admins: full access to /admin
    // Managers: access to /admin/backoffice/books and /admin/backoffice (read-only view of their team)
    // Employees: no access to /admin
    const role = userData?.role;

    if (role === 'admin') {
      // Full access — continue
    } else if (role === 'manager') {
      // Managers can view books and the main backoffice dashboard
      const managerAllowedPaths = [
        '/admin/backoffice',
        '/admin/backoffice/books',
        '/admin/backoffice/ai-terminal',
      ];
      const isAllowed = managerAllowedPaths.some((p) => pathname.startsWith(p));
      if (!isAllowed) {
        return NextResponse.redirect(new URL('/unauthorized', request.url));
      }
    } else {
      return NextResponse.redirect(new URL('/unauthorized', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
