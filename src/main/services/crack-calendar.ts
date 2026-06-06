import axios from "axios";
import { WebSocket } from "ws";
import { WindowManager } from "./window-manager";
import { logger } from "./logger";
import type { CrackCalendarGame, CrackCalendarMonth } from "@types";

const API_BASE_URL = "https://hydra-calendar-api.jagsinghwork0.workers.dev";
const WS_URL = "wss://hydra-calendar-api.jagsinghwork0.workers.dev/v1/live";

export const getAvailableMonths = async (): Promise<string[]> => {
  return axios
    .get(`${API_BASE_URL}/v1/months`)
    .then((response) => response.data.months || [])
    .catch((err) => {
      logger.error("Failed to fetch available months:", err);
      return [];
    });
};

export const getCalendarMonth = async (
  month: string
): Promise<CrackCalendarMonth | null> => {
  return axios
    .get(`${API_BASE_URL}/v1/month/${month}`)
    .then((response) => response.data)
    .catch((err) => {
      logger.error(`Failed to fetch calendar for month ${month}:`, err);
      return null;
    });
};

export const getGameDetail = async (
  slug: string
): Promise<CrackCalendarGame | null> => {
  return axios
    .get(`${API_BASE_URL}/v1/game/${slug}`)
    .then((response) => response.data)
    .catch((err) => {
      logger.error(`Failed to fetch game detail for ${slug}:`, err);
      return null;
    });
};

export const searchGames = async (
  query: string
): Promise<CrackCalendarGame[]> => {
  return axios
    .get(`${API_BASE_URL}/v1/search`, { params: { q: query } })
    .then((response) => response.data.results || [])
    .catch((err) => {
      logger.error(`Failed to search games for query ${query}:`, err);
      return [];
    });
};

let ws: WebSocket | null = null;

export const initCrackCalendarSocket = () => {
  if (ws) {
    ws.close();
  }

  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    logger.info("Crack calendar WebSocket connected");
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === "calendar_update") {
        WindowManager.mainWindow?.webContents.send("crack-calendar-updated");
      }
    } catch (err) {
      logger.error("Failed to parse crack calendar WebSocket message:", err);
    }
  });

  ws.on("close", () => {
    logger.info("Crack calendar WebSocket closed, reconnecting in 5 seconds...");
    setTimeout(initCrackCalendarSocket, 5000);
  });

  ws.on("error", (err) => {
    logger.error("Crack calendar WebSocket error:", err);
    ws?.close();
  });
};
