import { useEffect } from "react";
import type { Theme } from "@types";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { logger } from "@renderer/logger";
import { levelDBService } from "@renderer/services/leveldb.service";

export function useCustomTheme(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      removeCustomCss();
      return;
    }

    let isCancelled = false;

    const applyActiveTheme = async () => {
      try {
        const themes = (await levelDBService.values("themes")) as Theme[];

        if (isCancelled) return;

        const activeTheme = themes.find((theme) => theme.isActive);

        if (activeTheme?.code) {
          injectCustomCss(activeTheme.code);
        } else {
          removeCustomCss();
        }
      } catch (error) {
        logger.error("Failed to apply the custom theme in Big Picture", error);
      }
    };

    void applyActiveTheme();

    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      void applyActiveTheme();
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [enabled]);
}
