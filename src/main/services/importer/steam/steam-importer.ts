import path from "node:path";
import { SystemPath } from "../../system-path";
import fs from "node:fs";
import parseVDF from "./parse-VDF";

interface SteamApp {
  appid: string;
  name: string;
  installdir?: string;
  isInstalled?: boolean;
}

class SteamImporter {
  private static instance: SteamImporter;
  private steamInstallPath: string;
  private steamLibraryPaths: string[];
  private watchers: Map<string, fs.FSWatcher> = new Map();

  private constructor() {
    this.watchers = new Map();
  }

  static getInstance(): SteamImporter {
    if (!SteamImporter.instance) {
      SteamImporter.instance = new SteamImporter();
    }
    return SteamImporter.instance;
  }

  async initialize({ steamPath }: { steamPath: string | undefined }) {
    this.steamInstallPath = steamPath ?? (await this.getSteamInstallPath());
    this.steamLibraryPaths = await this.getSteamLibraryPaths();
  }

  async scanLibraries(): Promise<SteamApp[]> {
    const apps: SteamApp[] = [];
    for (const library of this.steamLibraryPaths) {
      const libraryPath = path.join(library, "steamapps");
      // read all files in the directory /steamapps
      // filter for files with the pattern appmanifest_[appid].acf
      const files = fs.readdirSync(libraryPath);
      const appmanifests = files.filter((file) =>
        file.match(/appmanifest_\d+\.acf/)
      );
      for (const appmanifest of appmanifests) {
        const appmanifestPath = path.join(libraryPath, appmanifest);
        const appmanifestContent = fs.readFileSync(appmanifestPath, "utf8");
        const [_, app] = parseVDF(appmanifestContent) as [
          string,
          Record<string, unknown>,
        ];

        // Verify if the installation directory exists
        // if doesnt exists, set isInstalled to false
        const appData = app as unknown as SteamApp;
        if (appData.installdir) {
          const installDirPath = path.join(
            libraryPath,
            "common",
            appData.installdir
          );
          appData.isInstalled = fs.existsSync(installDirPath);
        } else {
          appData.isInstalled = false;
        }

        apps.push(appData);
      }
    }
    return apps;
  }

  async startWatchers(callback: (library: string) => void) {
    if (this.watchers.size > 0) this.stopWatchers();

    // start a watcher for each library path
    for (const library of this.steamLibraryPaths) {
      const libraryPath = path.join(library, "steamapps");
      const watcher = fs.watch(libraryPath, (_event, _filename) => {
        callback(libraryPath);
      });
      this.watchers.set(library, watcher);
    }
    console.log("🔄️ Steam library watchers started");
  }

  async stopWatchers() {
    for (const [_, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }

  private async getSteamInstallPath() {
    const osType = process.platform;
    const possiblePaths = {
      linux: [
        path.join(SystemPath.getPath("home"), ".steam", "steam"),
        path.join(SystemPath.getPath("home"), ".local", "share", "Steam"),
      ],
      darwin: [
        path.join(
          SystemPath.getPath("home"),
          "Library",
          "Application Support",
          "Steam"
        ),
      ],
      win32: ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"],
    };

    const steamInstallPath = possiblePaths[osType];
    if (!steamInstallPath)
      throw new Error(`Steam install path not found for ${osType}`);

    for (const path of steamInstallPath) {
      if (
        fs.existsSync(path) &&
        fs.statSync(path).isDirectory() &&
        fs.readdirSync(path).includes("steamapps")
      ) {
        return path;
      }
    }
    throw new Error(`Steam install path not found for ${osType}`);
  }

  private async getSteamLibraryPaths() {
    // read the file /steamapps/libraryfolders.vdf
    const libraryFoldersPath = path.join(
      this.steamInstallPath,
      "steamapps",
      "libraryfolders.vdf"
    );
    const libraryFolders = fs.readFileSync(libraryFoldersPath, "utf8");
    const [_, libraries] = parseVDF(libraryFolders);
    return (libraries as Array<{ path: string }>).map(
      (library) => library.path
    );
  }
}

export default SteamImporter;
