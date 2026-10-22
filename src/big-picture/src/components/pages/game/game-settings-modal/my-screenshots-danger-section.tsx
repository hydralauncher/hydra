import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop } from "@types";
import {
  countPublishedScreenshotsForGame,
  deleteMyGameScreenshots,
  isLocalScreenshotForGame,
  notifyMyGameScreenshotsChanged,
  selectPendingLocalScreenshots,
  subscribeMyGameScreenshotsChanged,
  type MyScreenshotsDeletion,
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

interface MyScreenshotsCounts {
  local: number;
  published: number;
}

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
  counts: MyScreenshotsCounts
) => {
  if (deletion === "published") return counts.published > 0;
  if (deletion === "local") return counts.local > 0;
  return counts.published + counts.local > 0;
};

function useMyScreenshotsCounts(shop: GameShop, objectId: string) {
  const { userDetails } = useUserDetails();
  const userId = userDetails?.id ?? null;
  const [counts, setCounts] = useState<MyScreenshotsCounts>({
    local: 0,
    published: 0,
  });

  const refreshCounts = useCallback(async () => {
    try {
      const [localScreenshots, published] = await Promise.all([
        myGameScreenshotsLocal.getLocalScreenshotsForGame(shop, objectId),
        countPublishedScreenshotsForGame(
          { shop, objectId },
          userId,
          myGameScreenshotsApi,
          myGameScreenshotsLocal
        ),
      ]);
      setCounts({
        local: selectPendingLocalScreenshots(localScreenshots, {
          shop,
          objectId,
        }).length,
        published,
      });
    } catch (error) {
      logger.error("Failed to count screenshots for the game", error);
    }
  }, [objectId, shop, userId]);

  useEffect(() => {
    void refreshCounts();
    const unsubscribeLocal =
      globalThis.window.electron.onLocalScreenshotsChange((screenshots) => {
        const local = selectPendingLocalScreenshots(
          screenshots.filter((screenshot) =>
            isLocalScreenshotForGame(screenshot, shop, objectId)
          ),
          { shop, objectId }
        ).length;
        setCounts((current) => ({ ...current, local }));
      });
    const unsubscribeChanged = subscribeMyGameScreenshotsChanged(
      () => void refreshCounts()
    );
    return () => {
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [objectId, refreshCounts, shop]);

  return counts;
}

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
  const counts = useMyScreenshotsCounts(shop, objectId);
  const [pending, setPending] = useState<MyScreenshotsDeletion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const confirm = async () => {
    if (!pending) return;
    const deletion = pending;
    setIsDeleting(true);
    const result = await deleteMyGameScreenshots(
      deletion,
      { shop, objectId },
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
    showErrorToast(
      result.errorCode === "screenshots/game-deletion-rate-limited"
        ? t("delete_screenshots_rate_limited")
        : t("delete_screenshots_failed")
    );
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
