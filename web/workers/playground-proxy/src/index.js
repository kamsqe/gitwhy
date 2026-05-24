/**
 * gitwhy-playground-proxy
 *
 * A tiny Cloudflare Worker that proxies pre-indexed gitwhy SQLite files
 * from GitHub Releases to the browser playground. Its only job is to
 * re-emit the upstream asset with `Access-Control-Allow-Origin: *` so
 * that gitwhy.pages.dev/playground/ can fetch() the file cross-origin
 * (GitHub Release downloads ship without ACAO headers).
 *
 * Adding a new playground demo:
 *   1. Index the repo, slim the resulting commits.sqlite (drop llm_calls,
 *      query_feedback, cluster tables, VACUUM).
 *   2. `gh release upload <tag> <slimmed.db> --repo kamsqe/gitwhy`
 *   3. Add an entry to ASSET_MAP below mapping a short URL slug to the
 *      release download URL.
 *   4. Add a matching entry to the DEMOS array in
 *      web/src/components/playground/Playground.tsx pointing at this
 *      Worker's URL: `https://<worker>.workers.dev/<slug>.db`.
 *   5. `wrangler deploy` and you're done.
 *
 * Caching: we set a long edge cache. If you re-upload a release asset
 * with the SAME name, bump the slug (e.g. `express-v2.db`) or purge the
 * Worker cache from the dashboard — otherwise the CDN will serve stale.
 */

const ASSET_MAP = {
  'express.db':
    'https://github.com/kamsqe/gitwhy/releases/download/playground-data-v1/express.db',
};

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'Content-Length, Content-Type, Accept-Ranges, ETag',
  'access-control-max-age': '86400',
};

export default {
  async fetch(request, _env, _ctx) {
    const url = new URL(request.url);

    // CORS preflight — sql.js doesn't actually send these for simple GETs,
    // but the playground's `fetch()` may include credentials in some browser
    // configs, in which case the preflight fires. Cheap to handle either way.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'method-not-allowed', `${request.method} not allowed`);
    }

    // Root path: tiny index so a human poking the worker URL sees what it is
    // rather than a 404. Also exposes the asset list for debugging.
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        JSON.stringify(
          {
            name: 'gitwhy-playground-proxy',
            about:
              'CORS-friendly proxy for gitwhy playground SQLite assets hosted on GitHub Releases.',
            assets: Object.keys(ASSET_MAP),
            source: 'https://github.com/kamsqe/gitwhy/tree/web-ui/web/workers/playground-proxy',
          },
          null,
          2,
        ),
        {
          headers: {
            'content-type': 'application/json',
            ...CORS_HEADERS,
          },
        },
      );
    }

    const slug = url.pathname.slice(1); // strip leading "/"
    const upstreamUrl = ASSET_MAP[slug];

    if (!upstreamUrl) {
      return jsonError(404, 'unknown-asset', `no asset registered for "${slug}"`);
    }

    // Forward the request — including Range, If-None-Match, etc. — so the
    // browser can resume partial downloads. GitHub release assets do
    // support range requests.
    const forwardHeaders = new Headers();
    for (const passthrough of ['range', 'if-none-match', 'if-modified-since']) {
      const v = request.headers.get(passthrough);
      if (v) forwardHeaders.set(passthrough, v);
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: forwardHeaders,
        redirect: 'follow',
        // Cloudflare-managed cache: amortize the GitHub origin fetch across
        // many playground users. SQLite payloads are immutable per-version,
        // so we can be aggressive here.
        cf: {
          cacheTtl: 86400,
          cacheEverything: true,
        },
      });
    } catch (err) {
      return jsonError(502, 'upstream-fetch-failed', err.message || String(err));
    }

    // Build response headers: pass through the bits the browser actually
    // needs, drop anything that would leak GitHub internals or break the
    // CORS contract.
    const headers = new Headers(CORS_HEADERS);
    for (const h of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
    ]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/octet-stream');
    }
    // Browser-side cache: 1h on the user's machine, allow CDN revalidation.
    headers.set('cache-control', 'public, max-age=3600, s-maxage=86400');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: {
      'content-type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
