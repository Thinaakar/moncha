import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'moncha_session';
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const signedIn = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isAuthPage = AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isAuthPage) {
    if (signedIn && pathname !== '/reset-password') return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }
  if (!signedIn) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|_next/|brand/|icon.svg|favicon.ico|robots.txt).*)'],
};
