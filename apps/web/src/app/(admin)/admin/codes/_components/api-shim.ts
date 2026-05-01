/**
 * REST-to-tRPC compatibility shim — Codes Phase 1 (cannibalized port).
 *
 * Components ported from CodeCreator make REST calls (e.g. `/api/items`).
 * This shim wraps Even OS's tRPC procedures into Promise<Response>-shaped
 * responses with the same JSON envelope CodeCreator used:
 *   POST /api/items                 → { ok, item, first_use_of_bucket } | { ok: false, code, ... }
 *   POST /api/lookups/[kind]        → { ok, row } | { ok: false, code, errors }
 *   PATCH /api/lookups/[kind]/[code] → { ok, row } | { ok: false, code, errors }
 *   GET /api/buckets/[bucket]/peek  → { bucket, next_serial, first_use }
 *   GET /api/search?q=              → { results, q }
 *
 * This lets CreateItemForm, SearchBar, LookupRow, LookupSection stay
 * nearly-verbatim so they remain easy to merge with CodeCreator if a bug
 * fix lands during the parallel-run window. Phase 8 (Hardening) refactors
 * components to call tRPC directly.
 */

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const j = await res.json();
  if (j.error) {
    return {
      ok: false,
      code: j.error?.json?.data?.code === 'CONFLICT' ? 'duplicate_display_name' : 'error',
      message: j.error?.json?.message || j.error?.message || 'Request failed',
      _httpStatus: 400,
    };
  }
  return j.result?.data?.json;
}

async function trpcQuery(path: string, input: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export interface CompatResponse<T = any> {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
}

function envelope<T>(body: T, status = 200): CompatResponse<T> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/**
 * compatFetch — drop-in for fetch('/api/...').
 * Routes the URL to the right tRPC procedure and returns a CompatResponse
 * with .ok / .status / .json() semantics matching window.fetch.
 */
export async function compatFetch(url: string, init?: RequestInit): Promise<CompatResponse> {
  const u = new URL(url, 'http://x');  // base for relative URLs
  const path = u.pathname;
  const method = (init?.method || 'GET').toUpperCase();

  // POST /api/items
  if (path === '/api/items' && method === 'POST') {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    try {
      const result = await trpcMutate('codes.items.create', body);
      if ((result as any)?.ok === false) {
        return envelope({ ok: false, code: (result as any).code || 'error', message: (result as any).message }, 409);
      }
      return envelope({ ok: true, item: result.item, first_use_of_bucket: result.first_use_of_bucket });
    } catch (e: any) {
      return envelope({ ok: false, code: 'error', message: e?.message || 'Request failed' }, 500);
    }
  }

  // GET /api/items/[id]
  const itemDetailMatch = path.match(/^\/api\/items\/([^/]+)$/);
  if (itemDetailMatch && method === 'GET') {
    try {
      const result = await trpcQuery('codes.items.detail', itemDetailMatch[1]);
      return envelope(result);
    } catch (e: any) {
      return envelope({ ok: false, code: 'not_found', message: e?.message }, 404);
    }
  }

  // GET /api/search?q=
  if (path === '/api/search' && method === 'GET') {
    try {
      const q = u.searchParams.get('q') || '';
      const limit = Math.min(parseInt(u.searchParams.get('limit') || '10', 10) || 10, 50);
      const result = await trpcQuery('codes.items.search', { q, limit });
      return envelope(result);
    } catch (e: any) {
      return envelope({ ok: false, message: e?.message }, 500);
    }
  }

  // GET /api/buckets/[bucket]/peek
  const bucketMatch = path.match(/^\/api\/buckets\/([^/]+)\/peek$/);
  if (bucketMatch && method === 'GET') {
    try {
      const result = await trpcQuery('codes.buckets.peek', bucketMatch[1]);
      return envelope(result);
    } catch (e: any) {
      return envelope({ ok: false, code: 'bad_bucket_format', message: e?.message }, 400);
    }
  }

  // POST /api/lookups/[kind]
  const lookupAddMatch = path.match(/^\/api\/lookups\/([^/]+)$/);
  if (lookupAddMatch && method === 'POST') {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    try {
      const row = await trpcMutate('codes.lookups.create', { kind: lookupAddMatch[1], ...body });
      if ((row as any)?.ok === false) {
        return envelope({ ok: false, code: (row as any).code, message: (row as any).message }, 409);
      }
      return envelope({ ok: true, row });
    } catch (e: any) {
      return envelope({ ok: false, code: 'validation', message: e?.message }, 400);
    }
  }

  // PATCH /api/lookups/[kind]/[code]
  const lookupEditMatch = path.match(/^\/api\/lookups\/([^/]+)\/([^/]+)$/);
  if (lookupEditMatch && method === 'PATCH') {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    try {
      const row = await trpcMutate('codes.lookups.update', {
        kind: lookupEditMatch[1],
        code: decodeURIComponent(lookupEditMatch[2]),
        ...body,
      });
      if ((row as any)?.ok === false) {
        return envelope({ ok: false, code: (row as any).code, message: (row as any).message }, 400);
      }
      return envelope({ ok: true, row });
    } catch (e: any) {
      return envelope({ ok: false, code: 'validation', message: e?.message }, 400);
    }
  }

  // Fallback
  return envelope({ ok: false, code: 'not_implemented', message: `compatFetch: no route for ${method} ${path}` }, 501);
}
