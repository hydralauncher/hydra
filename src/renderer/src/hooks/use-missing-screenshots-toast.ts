import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "./use-toast";

export function useMissingScreenshotsToast() {
  const { t } = useTranslation("screenshots_capture");
  const { showErrorToast } = useToast();

  useEffect(
    () =>
      window.electron.onLocalScreenshotsMissing((count) => {
        if (document.visibilityState !== "visible") return;
        showErrorToast(
          t("missing_files_title"),
          t("missing_files_body", { count })
        );
      }),
    [showErrorToast, t]
  );
}
