import { useState } from "react";
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

const getDeletionErrorKey = (
  errorCode: MyScreenshotsDeletionErrorCode | null
) => {
  if (errorCode === "screenshots/game-deletion-rate-limited") {
    return "delete_screenshots_rate_limited";
  }
  if (errorCode === "screenshots/local-deletion-incomplete") {
    return "delete_screenshots_incomplete";
  }
  return "delete_screenshots_failed";
};

const logCountError = (error: unknown) => {
  logger.error("Failed to count screenshots for the game", error);
};

interface MyScreenshotsDangerSectionProps {
  shop: GameShop;
  objectId: string;
}

export function MyScreenshotsDangerSection({
  shop,
  objectId,
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

  const confirm = async () => {
    if (!pending) return;
    const deletion = pending;
    setIsDeleting(true);
    const result = await deleteMyGameScreenshots(
      deletion,
      {
        shop,
        objectId,
        isSignedIn: Boolean(userId) && !counts.hasPublishedFailed,
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
    showErrorToast(t(getDeletionErrorKey(result.errorCode)));
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
            onClick={() => setPending(deletion)}
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
      />
    </SettingsSection>
  );
}
