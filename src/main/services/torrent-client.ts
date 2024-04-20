import path from "node:path";
import cp from "node:child_process";
import fs from "node:fs";
import * as Sentry from "@sentry/electron/main";
import { Notification, app, dialog } from "electron";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import * as os from "os";

import { Game } from "@main/entity";
import { gameRepository, userPreferencesRepository } from "@main/repository";
import { t } from "i18next";
import { WindowManager } from "./window-manager";

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-download-manager",
  linux: "hydra-download-manager",
  win32: "hydra-download-manager.exe",
};

enum TorrentState {
  CheckingFiles = 1,
  DownloadingMetadata = 2,
  Downloading = 3,
  Finished = 4,
  Seeding = 5,
}

export interface TorrentUpdate {
  gameId: number;
  progress: number;
  downloadSpeed: number;
  timeRemaining: number;
  numPeers: number;
  numSeeds: number;
  status: TorrentState;
  folderName: string;
  fileSize: number;
  bytesDownloaded: number;
}

export const BITTORRENT_PORT = "5881";

export class TorrentClient {
  public static startTorrentClient(
    writePipePath: string,
    readPipePath: string
  ) {
    const commonArgs = [BITTORRENT_PORT, writePipePath, readPipePath];

    if (app.isPackaged) {
      const binaryName = binaryNameByPlatform[process.platform];
      const binaryPath = path.join(
        process.resourcesPath,
        "dist",
        "hydra-download-manager",
        binaryName
      );

      if (!fs.existsSync(binaryPath)) {
        dialog.showErrorBox(
          "Fatal",
          "Hydra download manager binary not found. Please check if it has been removed by Windows Defender."
        );

        app.quit();
      }

      cp.spawn(binaryPath, commonArgs, {
        stdio: "inherit",
        windowsHide: true,
      });
      return;
    }

    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "torrent-client",
      "main.py"
    );

    cp.spawn("python3", [scriptPath, ...commonArgs], {
      stdio: "inherit",
    });
  }

  private static getTorrentStateName(state: TorrentState) {
    if (state === TorrentState.CheckingFiles) return "checking_files";
    if (state === TorrentState.Downloading) return "downloading";
    if (state === TorrentState.DownloadingMetadata)
      return "downloading_metadata";
    if (state === TorrentState.Finished) return "finished";
    if (state === TorrentState.Seeding) return "seeding";
    return "";
  }

  private static getGameProgress(game: Game) {
    if (game.status === "checking_files") return game.fileVerificationProgress;
    return game.progress;
  }

  public static async onSocketData(data: Buffer) {
    const message = Buffer.from(data).toString("utf-8");

    try {
      const payload = JSON.parse(message) as TorrentUpdate;

      const updatePayload: QueryDeepPartialEntity<Game> = {
        bytesDownloaded: payload.bytesDownloaded,
        status: this.getTorrentStateName(payload.status),
      };

      if (payload.status === TorrentState.CheckingFiles) {
        updatePayload.fileVerificationProgress = payload.progress;
      } else {
        if (payload.folderName) {
          updatePayload.folderName = payload.folderName;
          updatePayload.fileSize = payload.fileSize;
        }
      }

      if (
        [TorrentState.Downloading, TorrentState.Seeding].includes(
          payload.status
        )
      ) {
        updatePayload.progress = payload.progress;
      }

      await gameRepository.update({ id: payload.gameId }, updatePayload);

      const game = await gameRepository.findOne({
        where: { id: payload.gameId },
        relations: { repack: true },
      });

      if (game.progress === 1) {
        const userPreferences = await userPreferencesRepository.findOne({
          where: { id: 1 },
        });

        if (userPreferences?.downloadNotificationsEnabled) {
          new Notification({
            title: t("download_complete", {
              ns: "notifications",
              lng: userPreferences.language,
            }),
            body: t("game_ready_to_install", {
              ns: "notifications",
              lng: userPreferences.language,
              title: game.title,
            }),
          }).show();
        }

        if (userPreferences?.ShutDownAfterDownloadEnabled) {
          const dialogPromise = dialog.showMessageBox({
            type: "question",
            buttons: ["Cancelar", "Confirmar"],
            defaultId: 1,
            title: "Confirmar desligamento",
            message: "O sistema será desligado em breve. Tem certeza de que deseja prosseguir?",
            detail: "Se você estiver usando o computador, clique em 'Cancelar' para abortar o desligamento, caso não selecione nada dentro de alguns segudos o desligamento ocorrerá",
            cancelId: 0,
            noLink: true,
            normalizeAccessKeys: false,
          });
          
          const timer = setTimeout(() => {
            userPreferencesRepository.update(
              { id: 1 },
              { ShutDownAfterDownloadEnabled: false }
            ).catch(error => {
              console.error("Erro ao redefinir o valor de ShutDownAfterDownloadEnabled:", error);
            });
        
            let shutdownCommand;
            switch (os.platform()) {
              case 'win32':
                shutdownCommand = 'shutdown /s /t 240'; // Comando de desligamento para Windows
                break;
              case 'darwin':
                shutdownCommand = 'sudo shutdown -h +4'; // Comando de desligamento para MacOS
                break;
              case 'linux':
                shutdownCommand = 'sudo shutdown -h +4'; // Comando de desligamento para Linux
                break;
              default:
                console.error('Sistema operacional não suportado para desligamento.');
                break;
            }
        
            if (shutdownCommand) {
              cp.exec(shutdownCommand, (error) => {
                if (error) {
                  console.error("Erro ao executar o comando de desligamento:", error);
                }
              });
            }
          }, 20000);
        
          dialogPromise.then(result => {
            if (result && result.response === 0) {
              clearTimeout(timer);
              
              let cancelShutdownCommand;
              switch (os.platform()) {
                case 'win32':
                  cancelShutdownCommand = 'shutdown /a'; // Comando de cancelamento para Windows
                  break;
                case 'darwin':
                  cancelShutdownCommand = 'sudo killall shutdown'; // Comando de cancelamento para MacOS
                  break;
                case 'linux':
                  cancelShutdownCommand = 'sudo killall shutdown'; // Comando de cancelamento para Linux
                  break;
                default:
                  console.error('Sistema operacional não suportado para cancelamento de desligamento.');
                  break;
              }
        
              if (cancelShutdownCommand) {
                cp.exec(cancelShutdownCommand, (error) => {
                  if (error) {
                    console.error("Erro ao executar o comando de cancelamento de desligamento:", error);
                  }
                });
              }
            }
          });
        }
      }

      if (WindowManager.mainWindow) {
        const progress = this.getGameProgress(game);
        WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);

        WindowManager.mainWindow.webContents.send(
          "on-download-progress",
          JSON.parse(JSON.stringify({ ...payload, game }))
        );
      }
    } catch (err) {
      Sentry.captureException(err);
    }
  }
}
