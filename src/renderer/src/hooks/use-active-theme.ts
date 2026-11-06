import { useCallback, useEffect } from "react";

import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { levelDBService } from "@renderer/services/leveldb.service";

export const useActiveTheme = (enabled = true) => {
  const loadAndApplyTheme = useCallback(async () => {
    const allThemes = (await levelDBService.values("themes")) as {
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code);
    } else {
      removeCustomCss();
    }
  }, []);

  useEffect(() => {
    if (enabled) void loadAndApplyTheme();
  }, [enabled, loadAndApplyTheme]);

  return loadAndApplyTheme;
};
