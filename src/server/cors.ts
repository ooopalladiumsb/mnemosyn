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

/**
 * Wrap a handler with CORS: answer `OPTIONS` preflight with a 204 + the allow headers; on other
 * requests, add `Access-Control-Allow-Origin` (echoing an allowed `Origin`, or `*`) to the response.
 * An `Origin` not in `origins` is NOT granted CORS headers (the browser then blocks it).
 */
export function withCors(
  _handler: (req: Request) => Promise<Response>,
  _opts: CorsOptions,
): (req: Request) => Promise<Response> {
  throw new Error("[TODO_D14] withCors not implemented");
}
