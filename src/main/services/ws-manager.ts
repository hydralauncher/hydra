import { WebSocket } from "ws";
import { HydraApi } from "./hydra-api";

export class WSManager {
  private static ws: WebSocket;

  static async connect() {
    const { token } = await HydraApi.post<{ token: string }>("/auth/ws");

    console.log("WS TOKEN", token);

    this.ws = new WebSocket(import.meta.env.MAIN_VITE_WS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    this.ws.on("open", () => {
      console.log("open");
    });

    this.ws.on("error", (error) => {
      console.error(error);
    });

    this.ws.on("message", (message) => {
      console.log(message);
    });
  }
}
