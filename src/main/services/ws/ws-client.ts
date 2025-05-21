import { WebSocket } from "ws";
import { HydraApi } from "../hydra-api";
import { Envelope } from "@main/generated/envelope";
import { logger } from "../logger";
import { friendRequestEvent } from "./events/friend-request";
import { friendGameSessionEvent } from "./events/friend-game-session";

export class WSClient {
  private static ws: WebSocket | null = null;
  private static reconnectInterval = 1_000;
  private static readonly maxReconnectInterval = 30_000;
  private static shouldReconnect = true;
  private static reconnecting = false;
  private static heartbeatInterval: NodeJS.Timeout | null = null;

  static async connect() {
    this.shouldReconnect = true;

    try {
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

        this.startHeartbeat();
      });

      this.ws.on("message", (message) => {
        if (message.toString() === "PONG") {
          return;
        }

        const envelope = Envelope.fromBinary(
          new Uint8Array(Buffer.from(message.toString()))
        );

        logger.info("Received WS envelope:", envelope);

        if (envelope.payload.oneofKind === "friendRequest") {
          friendRequestEvent(envelope.payload.friendRequest);
        }

        if (envelope.payload.oneofKind === "friendGameSession") {
          friendGameSessionEvent(envelope.payload.friendGameSession);
        }
      });

      this.ws.on("close", () => this.handleDisconnect("close"));
      this.ws.on("error", (err) => {
        logger.error("WS error:", err);
        this.handleDisconnect("error");
      });
    } catch (err) {
      logger.error("Failed to connect WS:", err);
      this.handleDisconnect("auth-failed");
    }
  }

  private static handleDisconnect(reason: string) {
    logger.warn(`WS disconnected due to ${reason}`);

    if (this.shouldReconnect) {
      this.cleanupSocket();
      this.tryReconnect();
    }
  }

  private static async tryReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;

    logger.info(`Reconnecting in ${this.reconnectInterval / 1000}s...`);

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        logger.error("Reconnect failed:", err);
        this.reconnectInterval = Math.min(
          this.reconnectInterval * 2,
          this.maxReconnectInterval
        );
        this.reconnecting = false;
        this.tryReconnect();
      }
    }, this.reconnectInterval);
  }

  private static cleanupSocket() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public static close() {
    this.shouldReconnect = false;
    this.reconnecting = false;
    this.cleanupSocket();
  }

  private static startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send("PING");
      }
    }, 15_000);
  }
}
