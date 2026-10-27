import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';

import { authConfig } from '@/auth.config';
import { HUB_TIMING_HEADER, isTimedHubPath } from '@/lib/social-hub/server-timing-path';

const { auth } = NextAuth(authConfig);

function isStaticAsset(pathname: string): boolean {
  // public/dashboards/* shares the /dashboards URL prefix with App Router pages.
  // Those files must not go through auth redirects (Image optimizer / <img> / fonts).
  return /\.(?:png|jpe?g|gif|webp|svg|ico|otf|ttf|woff2?|pdf|txt|map)$/i.test(pathname);
}

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (isStaticAsset(pathname)) return true;
  // Client dashboard links (token-gated in app code; no Auth.js session required).
  if (pathname.startsWith('/d/')) return true;
  if (pathname.startsWith('/dashboards/d/')) return true;
  // Deck PDFs are gated by project access_token, not Auth.js session.
  if (pathname.startsWith('/api/dashboards/deck/')) return true;
  if (pathname.startsWith('/api/auth')) return true;
  if (pathname === '/api/health') return true;
  if (pathname === '/api/webhooks/resend') return true;
  if (pathname === '/api/webhooks/agentmail') return true;
  if (pathname === '/api/webhooks/gcp-billing') return true;
  if (pathname.startsWith('/api/public/sender-headshots/')) return true;
  // Private reel review. The token in the path is the gate. No Auth.js session.
  if (pathname.startsWith('/watch/')) return true;
  if (pathname.startsWith('/api/watch/')) return true;
  // Local carousel template review (same as /social/render: no Auth.js session).
  if (pathname === '/api/social/template-reviews') return true;
  // Local meme lab while Google sign-in is down. Production still requires a session.
  if (
    process.env.NODE_ENV === 'development'
    && (pathname === '/memes' || pathname.startsWith('/memes/') || pathname.startsWith('/api/memes'))
  ) return true;
  return false;
}

function isProtectedPage(pathname: string): boolean {
  if (isStaticAsset(pathname)) return false;
  return pathname === '/hub'
    || pathname.startsWith('/hub/')
    || pathname.startsWith('/campaigns/')
    || pathname === '/events'
    || pathname.startsWith('/events/')
    || pathname === '/dashboards'
    || (pathname.startsWith('/dashboards/') && !pathname.startsWith('/dashboards/d/'))
    || pathname === '/trello'
    || pathname.startsWith('/trello/')
    || pathname === '/reels'
    || pathname.startsWith('/reels/')
    || pathname === '/seo'
    || pathname.startsWith('/seo/')
    || pathname === '/traffic'
    || pathname.startsWith('/traffic/')
    || pathname === '/explainers'
    || pathname.startsWith('/explainers/')
    || pathname === '/reels'
    || pathname.startsWith('/reels/')
    || pathname === '/stories'
    || pathname.startsWith('/stories/')
    || pathname === '/carousels'
    || pathname.startsWith('/carousels/')
    || pathname === '/last-few-days'
    || pathname.startsWith('/last-few-days/')
    || pathname === '/memes'
    || pathname.startsWith('/memes/')
    // Social Hub pages (the carousel render preview at /social/render stays as it was).
    || pathname === '/social'
    || (pathname.startsWith('/social/') && !pathname.startsWith('/social/render')
      // The fixture preview has no data and 404s in production builds (Social Hub D10).
      && !(process.env.NODE_ENV !== 'production' && pathname.startsWith('/social/preview')));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Edge config has no session callback — email presence means a valid Auth.js JWT.
  const signedIn = Boolean(req.auth?.user?.email);

  if (pathname.startsWith('/api/')) {
    if (!signedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (isProtectedPage(pathname) && !signedIn) {
    const login = new URL('/', req.nextUrl.origin);
    return NextResponse.redirect(login);
  }

  return continueWithTiming(req);
});

/** A hub page gets a request id so its RSC response can carry Server-Timing. */
function continueWithTiming(req: { headers: Headers; nextUrl: { pathname: string } }) {
  if (!isTimedHubPath(req.nextUrl.pathname)) return NextResponse.next();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(HUB_TIMING_HEADER, crypto.randomUUID());
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/',
    '/hub/:path*',
    '/campaigns/:path*',
    '/events',
    '/events/:path*',
    '/dashboards',
    '/dashboards/:path*',
    '/trello',
    '/trello/:path*',
    '/reels',
    '/reels/:path*',
    '/seo',
    '/seo/:path*',
    '/traffic',
    '/traffic/:path*',
    '/explainers',
    '/explainers/:path*',
    '/reels',
    '/reels/:path*',
    '/stories',
    '/stories/:path*',
    '/social',
    '/social/:path*',
    '/memes',
    '/memes/:path*',
    '/d/:path*',
    '/watch/:path*',
    '/api/:path*',
  ],
};
