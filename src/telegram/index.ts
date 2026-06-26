/**
 * D14 Telegram surface — Mini App auth. `TelegramInitDataAuthenticator` plugs Telegram WebApp
 * initData into the D13 `Authenticator` seam (per-Telegram-user vault). The Mini-App frontend (static,
 * GitHub Pages) calls the agent backend (separate HTTPS host, CORS-wrapped) with the initData.
 */
export * from "./init-data-auth.js";
