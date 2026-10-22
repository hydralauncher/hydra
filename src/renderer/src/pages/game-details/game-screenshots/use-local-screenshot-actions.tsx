import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmationModal } from "@renderer/components";
import { useDate, useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { getLocalScreenshotTitle, useLocalScreenshotViewer } from "@shared";
import type { LocalScreenshot } from "@types";

import { LocalScreenshotViewer } from "./local-screenshot-viewer";

export function useLocalScreenshotAlt() {
  const { t } = useTranslation("screenshots");
  const { formatDate } = useDate();

  return useCallback(
    (screenshot: LocalScreenshot) =>
      t("screenshot_alt", {
        game: getLocalScreenshotTitle(screenshot),
        date: formatDate(screenshot.capturedAt),
      }),
    [formatDate, t]
  );
}

export function useLocalScreenshotActions(screenshots: LocalScreenshot[]) {
  const { t } = useTranslation("screenshots");
  const { showErrorToast, showSuccessToast } = useToast();
  const describe = useLocalScreenshotAlt();
  const viewer = useLocalScreenshotViewer(screenshots);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<LocalScreenshot | null>(
    null
  );

  const setBusy = useCallback((clientId: string, isBusy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (isBusy) next.add(clientId);
      else next.delete(clientId);
      return next;
    });
  }, []);

  const upload = async (screenshot: LocalScreenshot) => {
    setBusy(screenshot.clientId, true);
    try {
      await window.electron.openScreenshotReview(screenshot.clientId);
    } catch (error) {
      logger.error("Failed to open the screenshot review window", error);
    } finally {
      setBusy(screenshot.clientId, false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { clientId } = pendingDelete;
    setPendingDelete(null);
    setBusy(clientId, true);
    try {
      await window.electron.deleteLocalScreenshot(clientId);
      showSuccessToast(t("screenshot_deleted"));
    } catch (error) {
      logger.error("Failed to delete the local screenshot", error);
      showErrorToast(t("delete_failed"));
    } finally {
      setBusy(clientId, false);
    }
  };

  const elements = (
    <>
      <ConfirmationModal
        visible={pendingDelete !== null}
        title={t("delete_local_screenshot_title")}
        descriptionText={t("delete_local_screenshot_description")}
        confirmButtonLabel={t("delete")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
      <LocalScreenshotViewer
        screenshots={screenshots}
        viewer={viewer}
        describe={describe}
      />
    </>
  );

  return {
    busyIds,
    describe,
    upload: (screenshot: LocalScreenshot) => void upload(screenshot),
    requestDelete: setPendingDelete,
    open: (screenshot: LocalScreenshot) => viewer.open(screenshot.clientId),
    elements,
  };
}
