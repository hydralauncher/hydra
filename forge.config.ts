import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { PublisherGithub } from "@electron-forge/publisher-github";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { ElectronegativityPlugin } from "@electron-forge/plugin-electronegativity";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: "./images/icon.png",
    extraResource: [
      "./resources/hydra.db",
      "./resources/icon_tray.png",
      "./resources/dist",
    ],
    protocols: [
      {
        name: "Hydra",
        schemes: ["hydralauncher"],
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: "./images/icon.ico",
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({
      options: {
        mimeType: ["x-scheme-handler/hydralauncher"],
      },
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "hydralauncher",
        name: "hydra",
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      devContentSecurityPolicy: "connect-src 'self' * 'unsafe-eval'",
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/index.html",
            js: "./src/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/preload.ts",
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
    new ElectronegativityPlugin({
      isSarif: true,
    }),
  ],
};

export default config;
