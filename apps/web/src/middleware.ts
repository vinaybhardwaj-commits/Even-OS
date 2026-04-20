import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * DEMO.5 — middleware: lock the demo session inside /demo/picker.
 *
 * The demo@even.in user has real credentials and a real JWT, but it
 * must never reach a feature route. If someone accidentally flips
 * DEMO_ACCOUNT_ENABLED on in the wrong environment, middleware is the
 * only thing that keeps a demo session from wandering into /admin,
 * /dashboard, or any caregiver/patient page.
 *
 * Flow:
 *   1. Read the `even_session` cookie. No cookie → next() (unauth'd
 *      users still need to reach /login, /forgot-password, etc.).
 *   2. Verify the JWT with `jose` directly — we avoid importing
 *      `@/lib/auth` here so the edge bundle doesn't pull in the full
 *      env validator (needs DATABASE_URL etc. at module-init).
 *   3. If the verified role is NOT 'demo', let the request through.
 *   4. If it IS 'demo':
 *        - allow GET/POST to the picker, the switch endpoint, and the
 *          logout route
 *        - allow the Next.js runtime assets (already excluded by the
 *          matcher, but we double-check paths starting with `/_next`)
 *        - everything else → 307 redirect to /demo/picker
 *
 * The JWT_SECRET env var must be present in the Vercel edge env — it
 * already is, because every non-middleware auth flow signs with it.
 */

const DEMO_ALLOWED_PREFIXES = [
  '/demo/picker', // the picker page itself
  '/api/demo/switch', // the role swap endpoint
  '/api/auth/logout', // must always be reachable so the operator can end the demo
];

// Never redirect framework / asset paths even if somehow the matcher
// misses them.
const ALWAYS_ALLOWED_PREFIXES = [
  '/_next/',
  '/favicon',
  '/static/',
];

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('even_session')?.value;
  if (!token) return NextResponse.next();

  const secretStr = process.env.JWT_SECRET;
  if (!secretStr) {
    // Secret missing in this environment — fail open rather than break
    // every route. The downstream pages still call getCurrentUser which
    // will reject invalid sessions.
    return NextResponse.next();
  }

  let role: string | undefined;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secretStr),
    );
    role = typeof payload.role === 'string' ? payload.role : undefined;
  } catch {
    // Invalid / expired / tampered token — downstream auth check will
    // bounce them. Don't interfere here.
    return NextResponse.next();
  }

  if (role !== 'demo') {
    return NextResponse.next();
  }

  const path = req.nextUrl.pathname;

  // Framework / asset escape hatch (defensive — matcher already scopes).
  for (const prefix of ALWAYS_ALLOWED_PREFIXES) {
    if (path.startsWith(prefix)) return NextResponse.next();
  }

  // Demo allowlist — exact match or prefix-with-slash match.
  for (const prefix of DEMO_ALLOWED_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return NextResponse.next();
    }
  }

  // Everything else: bounce the demo session back to the picker.
  const url = req.nextUrl.clone();
  url.pathname = '/demo/picker';
  url.search = '';
  return NextResponse.redirect(url);
}

/**
 * Matcher scope: apply to all routes EXCEPT static assets, images,
 * favicon, and the Next.js internals. tRPC (/api/trpc/*) and other
 * API routes are still matched so a demo session can't sneak
 * server-side data out via a direct fetch.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
