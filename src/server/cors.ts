/**
 * D14 — CORS for the agent backend. The Mini-App frontend is served STATICALLY (GitHub Pages,
 * `https://<user>.github.io/...`) while the backend (`POST /turn`) runs on a SEPARATE HTTPS host, so
 * the browser calls it cross-origin. `withCors` wraps a web `fetch` handler to answer the `OPTIONS`
 * preflight and add `Access-Control-Allow-*` headers for the allowed origin(s).
 *
 * ARCHITECT-OWNED CONTRACT. `CorsOptions` + `withCors` SIGNATURES are FROZEN; DeepSeek implements the
 * body (docs/TASK-deepseek-D14.md).
 */

/** CORS policy: which origins may call the backend, and which request headers are allowed. */
export interface CorsOptions {
  /** Allowed origins (exact match), e.g. `["https://ooopalladiumsb.github.io"]`. `"*"` allows any. */
  readonly origins: readonly string[] | "*";
  /** Allowed request headers (default includes content-type + x-telegram-init-data). */
  readonly headers?: readonly string[];
  /** Allowed methods (default `GET, POST, OPTIONS`). */
  readonly methods?: readonly string[];
}

/** Check if an origin is allowed under the CORS policy. */
function originAllowed(origin: string | null, origins: readonly string[] | "*"): boolean {
  if (!origin) return false;
  if (origins === "*") return true;
  return origins.includes(origin);
}

/**
 * Wrap a handler with CORS: answer `OPTIONS` preflight with a 204 + the allow headers; on other
 * requests, add `Access-Control-Allow-Origin` (echoing an allowed `Origin`, or `*`) to the response.
 * An `Origin` not in `origins` is NOT granted CORS headers (the browser then blocks it).
 */
export function withCors(
  handler: (req: Request) => Promise<Response>,
  opts: CorsOptions,
): (req: Request) => Promise<Response> {
  const methods = opts.methods ?? ["GET", "POST", "OPTIONS"];
  const headers = opts.headers ?? ["content-type", "x-telegram-init-data"];
  const allowMethods = methods.join(", ");
  const allowHeaders = headers.join(", ");

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const allowed = originAllowed(origin, opts.origins);

    // Handle preflight
    if (req.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      if (allowed && origin) {
        res.headers.set("Access-Control-Allow-Origin", opts.origins === "*" ? "*" : origin);
      }
      res.headers.set("Access-Control-Allow-Methods", allowMethods);
      res.headers.set("Access-Control-Allow-Headers", allowHeaders);
      res.headers.set("Access-Control-Max-Age", "86400");
      return res;
    }

    // Normal request — delegate to wrapped handler
    const res = await handler(req);

    // Add CORS header if origin is allowed
    if (allowed && origin) {
      // Clone the response to add headers (Response is immutable after creation)
      const corsRes = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
      corsRes.headers.set("Access-Control-Allow-Origin", opts.origins === "*" ? "*" : origin);
      return corsRes;
    }

    return res;
  };
}
