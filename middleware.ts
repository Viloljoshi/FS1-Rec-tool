import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookiesToSet = Array<{ name: string; value: string; options?: CookieOptions }>;

const PUBLIC_PATHS = ['/login', '/auth/callback'];

// Clear every Supabase auth cookie when the refresh token is invalid so the
// browser stops sending stale creds that blow up every subsequent request.
function clearSupabaseCookies(request: NextRequest, response: NextResponse): void {
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith('sb-')) {
      response.cookies.set(c.name, '', { maxAge: 0, path: '/' });
    }
  }
}

function unauthenticatedResponse(request: NextRequest, response: NextResponse): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const json = NextResponse.json(
      { error: 'unauthenticated', message: 'Session expired. Please log in again.' },
      { status: 401 }
    );
    for (const c of response.cookies.getAll()) json.cookies.set(c);
    return json;
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', request.nextUrl.pathname);
  const redirect = NextResponse.redirect(url);
  for (const c of response.cookies.getAll()) redirect.cookies.set(c);
  return redirect;
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (isPublic) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return response;
  }

  const supabase = createServerClient(
    url,
    anon,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        }
      }
    }
  );

  // `auth.getUser()` throws `AuthApiError: Invalid Refresh Token` when the
  // refresh token is missing/stale. Treat that exactly like "no user" —
  // wipe the bad cookies and redirect to login.
  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      clearSupabaseCookies(request, response);
    } else {
      user = data.user;
    }
  } catch {
    clearSupabaseCookies(request, response);
  }

  if (!user && !isPublic) {
    return unauthenticatedResponse(request, response);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/health).*)']
};
