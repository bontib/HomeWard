// Next 16 "proxy" (formerly middleware). Only a cheap cookie check to send signed-out
// visitors to the login page. The real session check is in requireSession() and withSession().
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const login = new URL("/login", request.url);
  const { pathname, search } = request.nextUrl;
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // API routes answer 401 themselves; auth pages and static files are public.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login|signup|ui).*)"],
};
