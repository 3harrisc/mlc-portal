import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Paths that are served without a session and never read `user`.
 *
 *   * /track/…            — customer share links, gated by their own token
 *   * /api/cron/…         — scheduled jobs, authenticated by CRON_SECRET
 *   * /api/email-to-run   — the Postmark inbound webhook, same secret
 *
 * Exported so the list can be asserted directly; the middleware itself needs
 * a NextRequest to exercise.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith("/track/") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/email-to-run")
  );
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Resolve public paths BEFORE touching Supabase.
  //
  // Why the order matters
  // --------------------
  // supabase.auth.getUser() is a network round-trip to Supabase Auth, and it
  // used to run unconditionally at the top of this function — including on
  // the paths below, which then returned without ever looking at `user`.
  // The matcher in middleware.ts covers every route, so that round-trip sat
  // in the request path of things that need no session at all, inside
  // Vercel's edge middleware time budget. When Supabase Auth was slow or
  // unreachable the middleware blew that budget and Vercel served
  // 504 MIDDLEWARE_INVOCATION_TIMEOUT — taking out customer share links and
  // the inbound email webhook, and leaving no trace in the app, because the
  // request never reached a route handler.
  //
  // These paths carry their own auth (a share token, or CRON_SECRET checked
  // inside the handler), so short-circuiting here costs nothing and removes
  // Supabase from their critical path entirely.
  if (isPublicPath(pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — this keeps cookies alive
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated user trying to access protected route
  if (!user && pathname !== "/login" && !pathname.startsWith("/auth/")) {
    // API routes: return 401 JSON instead of redirect
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated user on login page → redirect to home
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
