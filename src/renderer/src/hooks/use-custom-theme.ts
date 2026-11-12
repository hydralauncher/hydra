import { useCallback, useEffect } from "react";
import type { Theme } from "@types";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { logger } from "@renderer/logger";
import { levelDBService } from "@renderer/services/leveldb.service";

export function useCustomTheme() {
  const loadAndApplyTheme = useCallback(async () => {
    try {
      const themes = (await levelDBService.values("themes")) as Theme[];
      const activeTheme = themes.find((theme) => theme.isActive);

      if (activeTheme?.code) {
        injectCustomCss(activeTheme.code);
      } else {
        removeCustomCss();
      }
    } catch (error) {
      logger.error("Failed to apply the custom theme", error);
    }
  }, []);

  useEffect(() => {
    void loadAndApplyTheme();

    return window.electron.onCustomThemeUpdated(() => {
      void loadAndApplyTheme();
    });
  }, [loadAndApplyTheme]);
}
