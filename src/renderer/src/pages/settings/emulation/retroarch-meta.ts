import type { TFunction } from "i18next";
import type {
  RetroArchConfig,
  RetroArchCoreInstallProgress,
  RetroArchCoreName,
} from "@types";

import { installPercent } from "./setup/install-progress";

export interface RetroArchCoreMeta {
  name: RetroArchCoreName;
  label: string;
  platforms: string;
}

export const RETROARCH_CORE_LIST: RetroArchCoreMeta[] = [
  { name: "fceumm", label: "FCEUmm", platforms: "NES" },
  { name: "snes9x", label: "Snes9x", platforms: "SNES" },
  { name: "mupen64plus_next", label: "Mupen64Plus-Next", platforms: "N64" },
  { name: "gambatte", label: "Gambatte", platforms: "GB / GBC" },
  { name: "mgba", label: "mGBA", platforms: "GBA" },
];

export const RETROARCH_LABEL = "RetroArch";

export const retroArchCoreStatusText = (
  t: TFunction<"settings">,
  core: RetroArchCoreName,
  config: RetroArchConfig,
  progress: Partial<Record<RetroArchCoreName, RetroArchCoreInstallProgress>>
): string => {
  const current = progress[core];
  if (current && current.phase === "downloading") {
    return t("setup_install_downloading", {
      percent: installPercent(current.loaded, current.total),
    });
  }
  if (current && current.phase === "extracting") {
    return t("setup_install_extracting");
  }
  if (current && current.phase === "error") {
    return t("setup_install_failed");
  }
  const installed = config.cores[core];
  if (installed?.installed) {
    return installed.installedAt
      ? t("retroarch_core_installed_at", {
          date: new Date(installed.installedAt).toLocaleDateString(),
        })
      : t("retroarch_core_installed");
  }
  return t("retroarch_core_not_installed");
};
