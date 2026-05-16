import http from "node:http";
import { BrowserWindow } from "electron";
import axios from "axios";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

export class SteamAuthService {
  static openAuthWindow(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url) return;

        const url = new URL(`http://127.0.0.1${req.url}`);
        const params = Object.fromEntries(url.searchParams.entries());

        const closeWithMessage = (message: string) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<html><body style="font-family:sans-serif;text-align:center;padding:40px"><p>${message}</p></body></html>`
          );
          server.close();
        };

        if (params["openid.mode"] === "cancel") {
          closeWithMessage("Authentication cancelled.");
          reject(new Error("cancelled"));
          return;
        }

        try {
          const validationParams = new URLSearchParams(params);
          validationParams.set("openid.mode", "check_authentication");

          const { data } = await axios.post(
            STEAM_OPENID_URL,
            validationParams.toString(),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
          );

          if (!String(data).includes("is_valid:true")) {
            closeWithMessage("Steam authentication failed. Please try again.");
            reject(new Error("openid_validation_failed"));
            return;
          }

          const claimedId = params["openid.claimed_id"] ?? "";
          const match = claimedId.match(/\/(\d{17})$/);

          if (!match) {
            closeWithMessage("Could not extract Steam ID.");
            reject(new Error("steamid_not_found"));
            return;
          }

          closeWithMessage(
            "Steam account linked successfully! You can close this window."
          );
          resolve(match[1]);
        } catch (err) {
          closeWithMessage("An error occurred during authentication.");
          reject(err);
        }
      });

      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("server_start_failed"));
          return;
        }

        const port = address.port;
        // http:// is required here: Steam OpenID callback must use a plain
        // local server (no TLS on loopback), and the spec namespace URIs are
        // fixed identifiers defined by the OpenID 2.0 specification.
        const returnTo = `http://127.0.0.1:${port}/callback`; // NOSONAR

        const openIdParams = new URLSearchParams({
          "openid.ns": "http://specs.openid.net/auth/2.0", // NOSONAR — OpenID 2.0 spec namespace URI, must be http://
          "openid.mode": "checkid_setup",
          "openid.return_to": returnTo,
          "openid.realm": `http://127.0.0.1:${port}`, // NOSONAR — loopback callback, TLS not applicable
          "openid.identity":
            "http://specs.openid.net/auth/2.0/identifier_select", // NOSONAR — OpenID 2.0 spec URI
          "openid.claimed_id":
            "http://specs.openid.net/auth/2.0/identifier_select", // NOSONAR — OpenID 2.0 spec URI
        });

        const authUrl = `${STEAM_OPENID_URL}?${openIdParams.toString()}`;

        const authWindow = new BrowserWindow({
          width: 800,
          height: 680,
          title: "Sign in through Steam",
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        authWindow.loadURL(authUrl);

        authWindow.on("closed", () => {
          server.close();
          reject(new Error("window_closed"));
        });

        // Close window automatically once callback is served
        server.once("close", () => {
          if (!authWindow.isDestroyed()) authWindow.close();
        });
      });

      server.on("error", (err) => {
        reject(err);
      });
    });
  }
}
