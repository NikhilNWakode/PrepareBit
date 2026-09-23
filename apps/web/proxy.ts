import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next 16's `proxy` convention (formerly `middleware`).
 *
 * Routing convenience only — NOT the security boundary. It checks that a
 * session cookie is *present*, which it cannot validate (the cookie is signed
 * and the session lives in the API's database). Its job is to avoid rendering a
 * protected shell for a signed-out visitor, and to keep a signed-in user off
 * the login form. Every request that matters is authorised by the API.
 */
const SESSION_COOKIE = 'sid';
const GUEST_ONLY = new Set(['/login', '/register']);

export default function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hasSession && GUEST_ONLY.has(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
};
