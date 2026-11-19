import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig, hasSupabasePublicConfig } from "./lib/supabase/env";

// Routes that do not require an active session
const PUBLIC_PATHS = [
  "/login",
  "/unauthorized",
  "/pending-profile",
  "/auth/callback",
  "/track",
  "/intake",
];

export async function proxy(request: NextRequest) {
  if (!hasSupabasePublicConfig()) {
    return NextResponse.next({ request });
  }

  const { url, publishableKey } = getSupabasePublicConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  // Verify and refresh session with Supabase Auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  // Unauthenticated user attempting to access protected route
  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    const redirectRes = NextResponse.redirect(loginUrl);
    // Preserve any updated session cookies
    response.cookies.getAll().forEach((c) => {
      redirectRes.cookies.set(c);
    });
    return redirectRes;
  }

  // Authenticated user attempting to access /login
  if (user && pathname === "/login") {
    const redirectRes = NextResponse.redirect(new URL("/", request.url));
    response.cookies.getAll().forEach((c) => {
      redirectRes.cookies.set(c);
    });
    return redirectRes;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
