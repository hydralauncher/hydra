import fs from "node:fs";
import path from "node:path";
import { XDGPath } from "./xdg-path";
import { logger } from "./logger";

export interface Runner {
  path: string;
  name: string;
  type: "proton" | "wine";
}

export class ProtonService {
  private static readonly STEAM_COMMON_PATHS = [
    path.join(XDGPath.getPath("data"), "Steam", "steamapps", "common"),
    path.join(process.env.HOME || "", ".steam", "root", "compatibilitytools.d"),
  ];

  private static readonly SYSTEM_WINE_PATHS = ["/usr/bin/wine"];

  private static async findRunners(
    paths: string[],
    type: "proton" | "wine"
  ): Promise<Runner[]> {
    const runners: Runner[] = [];

    for (const p of paths) {
      if (fs.existsSync(p)) {
        if ((await fs.promises.lstat(p)).isDirectory()) {
          const files = await fs.promises.readdir(p);
          for (const file of files) {
            const runnerPath = path.join(p, file);
            if (fs.existsSync(path.join(runnerPath, "proton"))) {
              runners.push({
                path: runnerPath,
                name: file,
                type,
              });
            }
          }
        } else {
          runners.push({
            path: p,
            name: path.basename(p),
            type,
          });
        }
      }
    }
    return runners;
  }

  public static async discoverRunners(): Promise<Runner[]> {
    const protonRunners = await this.findRunners(
      this.STEAM_COMMON_PATHS,
      "proton"
    );
    const wineRunners = await this.findRunners(this.SYSTEM_WINE_PATHS, "wine");

    return [...protonRunners, ...wineRunners];
  }

  public static createPrefix(steamAppId: string): string {
    const prefixPath = path.join(
      XDGPath.getPath("data"),
      "prefixes",
      steamAppId
    );
    if (!fs.existsSync(prefixPath)) {
      fs.mkdirSync(prefixPath, { recursive: true });
    }
    return prefixPath;
  }

  public static async executeRunner(
    runner: Runner,
    executablePath: string,
    steamAppId: string,
    env: NodeJS.ProcessEnv = {}
  ) {
    const prefixPath = this.createPrefix(steamAppId);

    const command =
      runner.type === "proton" ? path.join(runner.path, "proton") : runner.path;

    const args = ["run", executablePath];

    const newEnv = {
      ...process.env,
      ...env,
      WINEPREFIX: prefixPath,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: path.join(
        XDGPath.getPath("data"),
        "Steam"
      ),
      STEAM_COMPAT_DATA_PATH: prefixPath,
    };

    logger.info(`Executing runner: ${command} ${args.join(" ")}`);
    logger.info(`With env: ${JSON.stringify(newEnv, null, 2)}`);

    const { spawn } = require("child_process");

    const child = spawn(command, args, {
      env: newEnv,
      detached: true,
      stdio: "ignore",
    });

    child.unref();
  }
}
