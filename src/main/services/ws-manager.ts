import { WebSocket } from "ws";
import { HydraApi } from "./hydra-api";
import { Envelope } from "@main/generated/envelope";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";

export class WSManager {
  private static ws: WebSocket | null = null;
  private static reconnectInterval = 1000;
  private static maxReconnectInterval = 30000;
  private static reconnectAttempts = 0;
  private static reconnecting = false;

  static async connect() {
    const { token } = await HydraApi.post<{ token: string }>("/auth/ws");

    this.ws = new WebSocket(import.meta.env.MAIN_VITE_WS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    this.ws.on("open", () => {
      logger.info("WS connected");
      this.reconnectInterval = 1000;
      this.reconnecting = false;
    });

    this.ws.on("message", (message) => {
      const envelope = Envelope.fromBinary(
        new Uint8Array(Buffer.from(message.toString()))
      );

      if (envelope.payload.oneofKind === "friendRequest") {
        WindowManager.mainWindow?.webContents.send("on-sync-friend-requests", {
          friendRequestCount: envelope.payload.friendRequest.friendRequestCount,
        });
      }
    });

    this.ws.on("close", () => {
      logger.warn("WS closed. Attempting reconnect...");
      this.tryReconnect();
    });

    this.ws.on("error", (err) => {
      logger.error("WS error:", err);
      this.tryReconnect();
    });
  }

  private static async tryReconnect() {
    if (this.reconnecting) return;

    this.reconnecting = true;
    this.reconnectAttempts++;

    const waitTime = Math.min(
      this.reconnectInterval * 2 ** this.reconnectAttempts,
      this.maxReconnectInterval
    );
    logger.info(`Reconnecting in ${waitTime / 1000}s...`);

    setTimeout(() => {
      this.connect();
    }, waitTime);
  }

  public static async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
