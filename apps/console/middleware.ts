import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

export function middleware(req: NextRequest) {
  if (verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const target = req.nextUrl.pathname + req.nextUrl.search;
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = target === '/' ? '' : `?next=${encodeURIComponent(target)}`;
  return NextResponse.redirect(url);
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico|brand/).*)'],
};
