import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { IS_DESKTOP } from "../constants";
import { useBigPictureToast } from "../hooks";

export function MissingScreenshotsToast() {
  const { t } = useTranslation("screenshots_capture");
  const { showErrorToast } = useBigPictureToast();

  useEffect(() => {
    if (!IS_DESKTOP) return;

    return globalThis.window.electron.onLocalScreenshotsMissing((count) => {
      if (document.visibilityState !== "visible") return;
      showErrorToast(t("missing_files_title"), {
        message: t("missing_files_body", { count }),
        fallbackVisual: "settings",
      });
    });
  }, [showErrorToast, t]);

  return null;
}
