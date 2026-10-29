import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { getLocalScreenshotTitle } from "@shared";
import { logger } from "@renderer/logger";

import { ConfirmationModal } from "../../../modals";
import { useBigPictureToast } from "../../../../hooks";
import { NavigationService } from "../../../../services";
import { formatScreenshotDate } from "../../screenshots";

export function useLocalScreenshotAlt() {
  const { t, i18n } = useTranslation("screenshots");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";

  return useCallback(
    (screenshot: LocalScreenshot) =>
      t("screenshot_alt", {
        game: getLocalScreenshotTitle(screenshot),
        date: formatScreenshotDate(screenshot.capturedAt, language),
      }),
    [language, t]
  );
}

export function useLocalScreenshotActions() {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const describe = useLocalScreenshotAlt();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<LocalScreenshot | null>(
    null
  );
  const focusAfterDeleteRef = useRef<string | null>(null);

  const requestDelete = useCallback(
    (screenshot: LocalScreenshot, focusAfterDeleteId: string | null = null) => {
      focusAfterDeleteRef.current = focusAfterDeleteId;
      setPendingDelete(screenshot);
    },
    []
  );

  const setBusy = useCallback((clientId: string, isBusy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (isBusy) next.add(clientId);
      else next.delete(clientId);
      return next;
    });
  }, []);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { clientId } = pendingDelete;
    setBusy(clientId, true);
    try {
      await globalThis.window.electron.deleteLocalScreenshot(clientId);
      const focusAfterDeleteId = focusAfterDeleteRef.current;
      focusAfterDeleteRef.current = null;
      if (focusAfterDeleteId) {
        NavigationService.getInstance().requestFocusWhenAvailable(
          focusAfterDeleteId
        );
      }
      setPendingDelete(null);
      showSuccessToast(t("screenshots_deleted"));
    } catch (error) {
      logger.error("Failed to delete the local screenshot", error);
      showErrorToast(t("delete_failed", { ns: "screenshots" }));
    } finally {
      setBusy(clientId, false);
    }
  };

  const elements = (
    <ConfirmationModal
      visible={pendingDelete !== null}
      backdropClassName="local-screenshot-viewer__confirmation-backdrop"
      title={t("screenshots_review_delete_title")}
      description={t("delete_local_screenshot_description", {
        ns: "screenshots",
      })}
      confirmLabel={t("screenshots_review_delete")}
      cancelLabel={t("screenshots_cancel")}
      danger
      loading={pendingDelete ? busyIds.has(pendingDelete.clientId) : false}
      onClose={() => setPendingDelete(null)}
      onConfirm={confirmDelete}
    />
  );

  return {
    busyIds,
    describe,
    requestDelete,
    elements,
  };
}

export type LocalScreenshotActions = ReturnType<
  typeof useLocalScreenshotActions
>;
