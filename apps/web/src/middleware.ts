import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  return NextResponse.redirect(new URL('/switch-acct', req.url));
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
