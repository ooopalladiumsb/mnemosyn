/**
 * D13 — thin `Bun.serve` binding for the agent handler (deployment only). The handler is a web
 * `fetch` function, so binding it to Bun is one line. This file is NOT exercised by any `node:test`
 * gate (it needs the Bun runtime); the testable surface is `createAgentHandler` in `handler.ts`.
 *
 * `Bun` is declared locally so this typechecks under Node's `tsc` without pulling `bun-types`.
 */
declare const Bun: {
  serve(opts: {
    port: number;
    fetch: (req: Request) => Response | Promise<Response>;
  }): { stop(): void; readonly port: number };
};

/** Bind a web `fetch` handler to a Bun HTTP server. Returns the running server (`.stop()` to close). */
export function serveBun(
  handler: (req: Request) => Promise<Response>,
  opts: { port: number },
): { stop(): void; readonly port: number } {
  return Bun.serve({ port: opts.port, fetch: handler });
}
