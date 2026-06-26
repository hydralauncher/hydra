import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { logger } from "@main/services/logger";
import { AuthPage } from "@shared";
import axios from "axios";
import i18next from "i18next";
import urlModule from "url";
import { app } from "electron";

const PAGE_SIZE = 100;

const openHydraCloudImport = async (_event: Electron.IpcMainInvokeEvent) => {
  return new Promise<{ imported: number; achievements: number }>(
    (resolve, reject) => {
      const searchParams = new URLSearchParams({ lng: i18next.language });
      const authUrl = `${import.meta.env.MAIN_VITE_AUTH_URL}${AuthPage.SignIn}?${searchParams.toString()}`;

      const { BrowserWindow } = require("electron");
      const win = new BrowserWindow({
        width: 500,
        height: 700,
        backgroundColor: "#1c1c1c",
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      win.loadURL(authUrl);

      let handled = false;
      win.webContents.on("will-navigate", async (_e, url) => {
        if (!url.startsWith("hydralauncher://auth") || handled) return;
        handled = true;
        win.close();

        try {
          const { payload } = urlModule.parse(url, true).query;
          const { accessToken } = JSON.parse(atob(payload as string));

          const official = axios.create({
            baseURL: import.meta.env.MAIN_VITE_API_URL,
            headers: {
              "User-Agent": `Hydra Launcher v${app.getVersion()}`,
              Authorization: `Bearer ${accessToken}`,
            },
          });

          const games: any[] = [];
          let skip = 0;
          for (;;) {
            const page = await official
              .get("/profile/games", { params: { take: PAGE_SIZE, skip } })
              .then((r) => r.data)
              .catch(() => []);
            games.push(...page);
            if (page.length < PAGE_SIZE) break;
            skip += PAGE_SIZE;
          }

          logger.log(`importFromHydraCloud: fetched ${games.length} games`);

          for (let i = 0; i < games.length; i += 30) {
            await HydraApi.post(
              "/profile/games/batch",
              games.slice(i, i + 30).map((g: any) => ({
                objectId: g.objectId,
                title: g.title,
                shop: g.shop,
                playTimeInMilliseconds: g.playTimeInMilliseconds ?? 0,
                lastTimePlayed: g.lastTimePlayed ?? null,
                isFavorite: g.isFavorite ?? false,
                isPinned: g.isPinned ?? false,
              }))
            ).catch(() => {});
          }

          let totalAchievements = 0;
          for (const game of games) {
            const achievements = await official
              .get(`/games/${game.shop}/${game.objectId}/achievements`)
              .then((r) => r.data?.achievements ?? [])
              .catch(() => []);
            const unlocked = achievements.filter((a: any) => a.unlocked);
            if (!unlocked.length) continue;
            await HydraApi.put(
              `/profile/games/${game.shop}/${game.objectId}/achievements`,
              unlocked.map((a: any) => ({
                name: a.name,
                unlockedAt: new Date(a.unlockTime * 1000).toISOString(),
              }))
            ).catch(() => {});
            totalAchievements += unlocked.length;
          }

          logger.log(
            `importFromHydraCloud: done, ${games.length} games, ${totalAchievements} achievements`
          );
          resolve({ imported: games.length, achievements: totalAchievements });
        } catch (err) {
          reject(err);
        }
      });

      win.on("closed", () => {
        if (!handled) reject(new Error("cancelled"));
      });
    }
  );
};

registerEvent("importFromHydraCloud", openHydraCloudImport);
