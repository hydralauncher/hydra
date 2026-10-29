import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, ConfirmationModal } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  deleteMyGameScreenshots,
  notifyMyGameScreenshotsChanged,
  useMyGameScreenshotCounts,
  type MyGameScreenshotCounts,
  type MyScreenshotsDeletion,
  type MyScreenshotsDeletionErrorCode,
} from "@shared";
import type { GameShop } from "@types";

import {
  myGameScreenshotsApi,
  myGameScreenshotsLocal,
} from "../../game-screenshots/my-game-screenshots-bridge";

const CLEANUP_ERROR_KEYS: Partial<
  Record<MyScreenshotsDeletionErrorCode, string>
> = {
  "screenshots/local-cleanup-failed": "delete_screenshots_local_cleanup_failed",
  "screenshots/published-cleanup-failed":
    "delete_screenshots_published_cleanup_failed",
};

const getDeletionErrorKey = (
  deletion: MyScreenshotsDeletion,
  {
    errorCode,
    deleted,
  }: { errorCode: MyScreenshotsDeletionErrorCode | null; deleted: number }
) => {
  if (errorCode === "screenshots/local-deletion-incomplete") {
    return "delete_screenshots_incomplete";
  }
  if (deletion === "local") return "delete_screenshots_failed";
  const cleanupKey = errorCode ? CLEANUP_ERROR_KEYS[errorCode] : undefined;
  if (cleanupKey) {
    return deleted > 0 ? cleanupKey : "delete_screenshots_failed";
  }
  if (deleted > 0) return "delete_screenshots_partial";
  return errorCode === "screenshots/game-deletion-rate-limited"
    ? "delete_screenshots_rate_limited_kept"
    : "delete_screenshots_failed_kept";
};

const logCountError = (error: unknown) =>
  logger.error("Failed to count screenshots for the game", error);

const DELETIONS: MyScreenshotsDeletion[] = ["all", "published", "local"];

const DELETION_LABEL_KEYS: Record<MyScreenshotsDeletion, string> = {
  all: "delete_all_screenshots",
  published: "delete_published_screenshots",
  local: "delete_local_screenshots",
};

const hasSomethingToDelete = (
  deletion: MyScreenshotsDeletion,
  counts: MyGameScreenshotCounts
) => {
  if (deletion === "published") return counts.published > 0;
  if (deletion === "local") return counts.local > 0;
  return counts.published + counts.local > 0;
};

interface MyScreenshotsDangerZoneProps {
  shop: GameShop;
  objectId: string;
}

export function MyScreenshotsDangerZone({
  shop,
  objectId,
}: Readonly<MyScreenshotsDangerZoneProps>) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const { showSuccessToast, showErrorToast } = useToast();
  const userId = userDetails?.id ?? null;
  const counts = useMyGameScreenshotCounts({
    userId,
    shop,
    objectId,
    api: myGameScreenshotsApi,
    local: myGameScreenshotsLocal,
    onError: logCountError,
  });
  const [pending, setPending] = useState<MyScreenshotsDeletion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const confirm = async () => {
    if (!pending) return;
    const deletion = pending;
    setPending(null);
    setIsDeleting(true);
    const result = await deleteMyGameScreenshots(
      deletion,
      {
        shop,
        objectId,
        isSignedIn: Boolean(userId),
      },
      myGameScreenshotsApi,
      myGameScreenshotsLocal
    );
    setIsDeleting(false);
    notifyMyGameScreenshotsChanged();

    if (result.ok) {
      showSuccessToast(
        t("screenshots_deleted_count", { count: result.deleted })
      );
      return;
    }

    logger.error("Failed to delete screenshots for the game", result.error);
    showErrorToast(t(getDeletionErrorKey(deletion, result)));
  };

  return (
    <div className="game-options-modal__my-screenshots">
      <h3>{t("my_screenshots")}</h3>
      <div className="game-options-modal__danger-zone-buttons">
        {DELETIONS.map((deletion) => (
          <Button
            key={deletion}
            theme="danger"
            disabled={isDeleting || !hasSomethingToDelete(deletion, counts)}
            onClick={() => setPending(deletion)}
          >
            {t(DELETION_LABEL_KEYS[deletion])}
          </Button>
        ))}
      </div>

      <ConfirmationModal
        visible={pending !== null}
        title={pending ? t(`${DELETION_LABEL_KEYS[pending]}_title`) : ""}
        descriptionText={
          pending ? t(`${DELETION_LABEL_KEYS[pending]}_description`) : ""
        }
        confirmButtonLabel={t("delete")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        onConfirm={() => void confirm()}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
