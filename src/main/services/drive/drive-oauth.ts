import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { shell } from "electron";
import axios from "axios";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import { logger } from "../logger";

// Loopback OAuth 2.0 flow with PKCE (RFC 8252). Google-issued "Desktop app"
// OAuth clients are public: no client secret is required when combined with
// PKCE. Users create their own client in Google Cloud Console and paste the
// client ID into the settings UI (stored in Level DB under driveOAuthClient).
//
// We open the system browser to Google's consent page, spin up an ephemeral
// HTTP server on 127.0.0.1:<random>, wait for the redirect with the code, and
// exchange it for tokens. Refresh tokens live in Level DB and are used to
// mint short-lived access tokens on demand.

interface DriveOAuthClient {
  clientId: string;
  clientSecret?: string; // Optional — only if the user configured a "Web" client instead of "Desktop".
}

interface DriveAuthTokens {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number; // unix ms
  scope: string;
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ACCESS_TOKEN_EXPIRY_SLACK_MS = 60_000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generateCodeVerifier(): string {
  return b64url(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}

async function loadClient(): Promise<DriveOAuthClient | null> {
  try {
    return (await db.get<string, DriveOAuthClient>(levelKeys.driveOAuthClient, {
      valueEncoding: "json",
    })) ?? null;
  } catch {
    return null;
  }
}

async function loadTokens(): Promise<DriveAuthTokens | null> {
  try {
    return (await db.get<string, DriveAuthTokens>(levelKeys.driveAuth, {
      valueEncoding: "json",
    })) ?? null;
  } catch {
    return null;
  }
}

export async function saveOAuthClient(client: DriveOAuthClient): Promise<void> {
  await db.put(levelKeys.driveOAuthClient, client, { valueEncoding: "json" });
}

export async function getOAuthClient(): Promise<DriveOAuthClient | null> {
  return loadClient();
}

export async function isDriveConnected(): Promise<boolean> {
  const tokens = await loadTokens();
  return Boolean(tokens?.refreshToken);
}

export async function disconnectDrive(): Promise<void> {
  const tokens = await loadTokens();
  if (tokens?.refreshToken) {
    // Best-effort revoke — Google returns 200 for valid tokens, 400 otherwise.
    // Either way we drop local state.
    await axios
      .post(GOOGLE_REVOKE_URL, new URLSearchParams({ token: tokens.refreshToken }), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        validateStatus: () => true,
      })
      .catch(() => undefined);
  }
  await db.del(levelKeys.driveAuth).catch(() => undefined);
  await db.del(levelKeys.driveRootFolderId).catch(() => undefined);
}

function successPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connected</title>
<style>body{font-family:system-ui;background:#0f1116;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
.c{padding:32px;background:#161923;border-radius:12px;text-align:center;max-width:360px}h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#aab;font-size:14px}</style></head>
<body><div class="c"><h1>Google Drive connected</h1><p>You can close this tab and return to Hydra.</p></div></body></html>`;
}

function errorPage(msg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Failed</title>
<style>body{font-family:system-ui;background:#0f1116;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
.c{padding:32px;background:#161923;border-radius:12px;text-align:center;max-width:360px}h1{margin:0 0 8px;font-size:20px;color:#ffb3b3}p{margin:0;color:#aab;font-size:14px}</style></head>
<body><div class="c"><h1>Connection failed</h1><p>${msg}</p></div></body></html>`;
}

export async function connectDrive(): Promise<void> {
  const client = await loadClient();
  if (!client?.clientId) {
    throw new Error(
      "Google OAuth client not configured. Paste your client ID in Settings → Cloud Storage first."
    );
  }

  const state = b64url(crypto.randomBytes(16));
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Start listener FIRST so we know the port before we hand the URL to the
  // browser. We can't call listen(0) and read the port later because opening
  // the browser is async and the redirect might arrive before we're ready.
  const server = http.createServer();
  const listening = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) resolve(addr.port);
      else reject(new Error("Failed to bind loopback port"));
    });
  });
  const port = await listening;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        server.close();
        reject(new Error("OAuth flow timed out after 5 minutes"));
      },
      5 * 60 * 1000
    );
    server.on("request", (req, res) => {
      try {
        const parsed = new URL(req.url ?? "", `http://127.0.0.1:${port}`);
        if (parsed.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = parsed.searchParams.get("code");
        const returnedState = parsed.searchParams.get("state");
        const error = parsed.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (error) {
          res.end(errorPage(error));
          clearTimeout(timeout);
          server.close();
          reject(new Error(`Google returned error: ${error}`));
          return;
        }
        if (!code || returnedState !== state) {
          res.end(errorPage("state mismatch"));
          clearTimeout(timeout);
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }
        res.end(successPage());
        clearTimeout(timeout);
        server.close();
        resolve(code);
      } catch (err) {
        res.writeHead(500).end();
        clearTimeout(timeout);
        server.close();
        reject(err as Error);
      }
    });
  });

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", client.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", DRIVE_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent"); // ensure refresh_token
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  await shell.openExternal(authUrl.toString());
  const code = await codePromise;

  const body = new URLSearchParams({
    code,
    client_id: client.clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  if (client.clientSecret) body.set("client_secret", client.clientSecret);

  const { data } = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  }>(GOOGLE_TOKEN_URL, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app's access in your Google Account settings, then try again."
    );
  }

  await db.put<string, DriveAuthTokens>(
    levelKeys.driveAuth,
    {
      refreshToken: data.refresh_token,
      accessToken: data.access_token,
      accessTokenExpiresAt: Date.now() + data.expires_in * 1000 - ACCESS_TOKEN_EXPIRY_SLACK_MS,
      scope: data.scope,
    },
    { valueEncoding: "json" }
  );

  logger.info("[drive] connected");
}

async function refreshAccessToken(): Promise<DriveAuthTokens> {
  const [client, tokens] = await Promise.all([loadClient(), loadTokens()]);
  if (!client?.clientId) throw new Error("OAuth client missing");
  if (!tokens?.refreshToken) throw new Error("Drive not connected");

  const body = new URLSearchParams({
    client_id: client.clientId,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  });
  if (client.clientSecret) body.set("client_secret", client.clientSecret);

  const { data } = await axios.post<{
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  }>(GOOGLE_TOKEN_URL, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const updated: DriveAuthTokens = {
    refreshToken: tokens.refreshToken,
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + data.expires_in * 1000 - ACCESS_TOKEN_EXPIRY_SLACK_MS,
    scope: data.scope ?? tokens.scope,
  };
  await db.put(levelKeys.driveAuth, updated, { valueEncoding: "json" });
  return updated;
}

export async function getAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new Error("Drive not connected");
  if (Date.now() < tokens.accessTokenExpiresAt) return tokens.accessToken;
  const refreshed = await refreshAccessToken();
  return refreshed.accessToken;
}
