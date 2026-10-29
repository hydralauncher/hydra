import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop } from "@types";
import {
  deleteMyGameScreenshots,
  notifyMyGameScreenshotsChanged,
  useMyGameScreenshotCounts,
  type MyGameScreenshotCounts,
  type MyScreenshotsDeletion,
  type MyScreenshotsDeletionErrorCode,
} from "@shared";
import { logger } from "@renderer/logger";
import {
  myGameScreenshotsApi,
  myGameScreenshotsLocal,
} from "@renderer/pages/game-details/game-screenshots/my-game-screenshots-bridge";

import { Button, VerticalFocusGroup } from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useBigPictureToast, useUserDetails } from "../../../../hooks";
import { NavigationService } from "../../../../services";

const DELETIONS: MyScreenshotsDeletion[] = ["all", "published", "local"];

const DELETION_LABEL_KEYS: Record<MyScreenshotsDeletion, string> = {
  all: "delete_all_screenshots",
  published: "delete_published_screenshots",
  local: "delete_local_screenshots",
};

export const getMyScreenshotsDeleteFocusId = (
  deletion: MyScreenshotsDeletion
) => `game-danger-zone-my-screenshots-${deletion}`;

const hasSomethingToDelete = (
  deletion: MyScreenshotsDeletion,
  counts: MyGameScreenshotCounts
) => {
  if (deletion === "published") return counts.published > 0;
  if (deletion === "local") return counts.local > 0;
  return counts.published + counts.local > 0;
};

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

const logCountError = (error: unknown) => {
  logger.error("Failed to count screenshots for the game", error);
};

interface MyScreenshotsDangerSectionProps {
  shop: GameShop;
  objectId: string;
  fallbackFocusId: string;
}

export function MyScreenshotsDangerSection({
  shop,
  objectId,
  fallbackFocusId,
}: Readonly<MyScreenshotsDangerSectionProps>) {
  const { t } = useTranslation("screenshots");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const { userDetails } = useUserDetails();
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
  const lastPressedRef = useRef<MyScreenshotsDeletion | null>(null);
  const [returningTo, setReturningTo] = useState<MyScreenshotsDeletion | null>(
    null
  );

  useEffect(() => {
    if (!returningTo) return;
    if (!isDeleting && hasSomethingToDelete(returningTo, counts)) return;

    setReturningTo(null);
    const navigation = NavigationService.getInstance();
    const focusedId = navigation.getCurrentFocusId();
    if (
      focusedId === null ||
      focusedId === getMyScreenshotsDeleteFocusId(returningTo)
    ) {
      navigation.requestFocusWhenAvailable(fallbackFocusId);
    }
  }, [counts, fallbackFocusId, isDeleting, returningTo]);

  const confirm = async () => {
    if (!pending) return;
    const deletion = pending;
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
    setPending(null);
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
    <SettingsSection
      className="game-danger-zone-settings-tab__section"
      title={t("my_screenshots")}
      description={t("screenshots_danger_zone_description", {
        ns: "big_picture",
      })}
    >
      <VerticalFocusGroup className="game-danger-zone-settings-tab__buttons">
        {DELETIONS.map((deletion) => (
          <Button
            key={deletion}
            focusId={getMyScreenshotsDeleteFocusId(deletion)}
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            disabled={isDeleting || !hasSomethingToDelete(deletion, counts)}
            onClick={() => {
              lastPressedRef.current = deletion;
              setReturningTo(null);
              setPending(deletion);
            }}
          >
            {t(DELETION_LABEL_KEYS[deletion])}
          </Button>
        ))}
      </VerticalFocusGroup>

      <ConfirmationModal
        visible={pending !== null}
        title={pending ? t(`${DELETION_LABEL_KEYS[pending]}_title`) : ""}
        description={
          pending ? t(`${DELETION_LABEL_KEYS[pending]}_description`) : ""
        }
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        loading={isDeleting}
        onClose={() => {
          if (!isDeleting) setPending(null);
        }}
        onConfirm={confirm}
        onExitComplete={() => setReturningTo(lastPressedRef.current)}
      />
    </SettingsSection>
  );
}
