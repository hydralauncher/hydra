import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { toLocalScreenshotUrl, useLocalScreenshotViewer } from "@shared";
import { logger } from "@renderer/logger";

import { ConfirmationModal } from "../../../modals";
import { requestScreenshotReview } from "../../../screenshot-review-modal";
import { useBigPictureToast } from "../../../../hooks";
import { formatScreenshotDate } from "../../screenshots";
import { ScreenshotDialogPresence } from "../../screenshots/screenshot-dialog-presence";
import { MediaViewer } from "../media-viewer";

export const getLocalScreenshotTitle = (screenshot: LocalScreenshot) =>
  (screenshot.shop === "custom" && screenshot.customGameTitle) ||
  screenshot.gameTitle;

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

interface LocalScreenshotViewerProps {
  screenshots: LocalScreenshot[];
  viewer: ReturnType<typeof useLocalScreenshotViewer>;
  describe: (screenshot: LocalScreenshot) => string;
}

function LocalScreenshotViewer({
  screenshots,
  viewer,
  describe,
}: Readonly<LocalScreenshotViewerProps>) {
  const items = useMemo(
    () =>
      screenshots.map((screenshot) => ({
        id: screenshot.clientId,
        type: "image" as const,
        src: toLocalScreenshotUrl(screenshot.path),
        alt: describe(screenshot),
      })),
    [describe, screenshots]
  );

  if (!viewer.current || viewer.index < 0) return null;

  return (
    <MediaViewer
      items={items}
      index={viewer.index}
      className="local-screenshot-viewer"
      showFilmstrip={false}
      onNavigate={(index) => {
        const next = screenshots[index];
        if (next) viewer.open(next.clientId);
      }}
      onClose={viewer.close}
    />
  );
}

export function useLocalScreenshotActions(screenshots: LocalScreenshot[]) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
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

  const upload = useCallback((screenshot: LocalScreenshot) => {
    requestScreenshotReview({
      gameKey: `manual:${screenshot.clientId}`,
      shop: screenshot.shop,
      objectId: screenshot.objectId ?? "",
      gameTitle: getLocalScreenshotTitle(screenshot),
      clientIds: [screenshot.clientId],
    });
  }, []);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { clientId } = pendingDelete;
    setBusy(clientId, true);
    try {
      await globalThis.window.electron.deleteLocalScreenshot(clientId);
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
    <>
      <ScreenshotDialogPresence isOpen={pendingDelete !== null} />
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
    upload,
    requestDelete: setPendingDelete,
    open: (screenshot: LocalScreenshot) => viewer.open(screenshot.clientId),
    elements,
  };
}

export type LocalScreenshotActions = ReturnType<
  typeof useLocalScreenshotActions
>;
