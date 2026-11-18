import http from "node:http";
import type { UserPreferences } from "@types";
import { appVersion } from "@main/constants";
import { gamesSublevel } from "@main/level";
import { logger } from "../logger";
import {
  buildLocalApiGamesResponse,
  isAuthorizedLocalApiRequest,
  LOCAL_API_DEFAULT_PORT,
  LOCAL_API_VERSION,
} from "./local-api-library";

const sendJson = (
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown
) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

export class LocalApi {
  private static server: http.Server | null = null;
  private static host = "";
  private static port = 0;
  private static token = "";

  private static async handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ) {
    try {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "method_not_allowed" });
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://localhost");

      if (
        !isAuthorizedLocalApiRequest(
          request.headers.authorization,
          LocalApi.token
        )
      ) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }

      switch (requestUrl.pathname) {
        case "/api/v1/info":
          sendJson(response, 200, {
            app: "hydra",
            version: appVersion,
            apiVersion: LOCAL_API_VERSION,
          });
          return;
        case "/api/v1/library/games": {
          const games = await gamesSublevel.values().all();
          sendJson(response, 200, buildLocalApiGamesResponse(games));
          return;
        }
        default:
          sendJson(response, 404, { error: "not_found" });
      }
    } catch (error) {
      logger.error("Local API request failed", error);
      sendJson(response, 500, { error: "internal_error" });
    }
  }

  private static syncQueue: Promise<void> = Promise.resolve();

  // Preference saves can overlap (e.g. a port commit landing next to a LAN
  // toggle). Serialize them so a restart never leaves an untracked listener.
  public static syncUserPreferences(
    preferences: UserPreferences | null
  ): Promise<void> {
    this.syncQueue = this.syncQueue
      .catch(() => {})
      .then(() => this.applyUserPreferences(preferences));
    return this.syncQueue;
  }

  private static async applyUserPreferences(
    preferences: UserPreferences | null
  ) {
    const host = preferences?.localApiBindLan ? "0.0.0.0" : "127.0.0.1";
    const port = preferences?.localApiPort || LOCAL_API_DEFAULT_PORT;
    this.token = preferences?.localApiToken ?? "";

    const shouldListen = Boolean(preferences?.localApiEnabled);
    const alreadyListening =
      this.server !== null && this.host === host && this.port === port;

    if (!shouldListen) {
      await this.stopServer();
      return;
    }

    if (alreadyListening) return;

    await this.stopServer();

    const server = http.createServer((request, response) =>
      this.handleRequest(request, response)
    );

    server.on("error", (error) => {
      logger.error("Local API server error", error);
    });

    // Track the server before it is listening so a failed start is cleaned up
    // and a queued shutdown can see it.
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        this.host = host;
        this.port = port;
        logger.info(`Local API listening on http://${host}:${port}/api/v1`);
        resolve();
      });
    }).catch((error) => {
      if (this.server === server) this.server = null;
      server.close();
      throw error;
    });
  }

  private static async stopServer() {
    const server = this.server;
    this.server = null;

    if (!server) return;

    // Drop keep-alive sockets so close() does not wait on an idle poller.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info("Local API stopped");
  }

  public static shutdown() {
    return this.syncUserPreferences(null);
  }
}
