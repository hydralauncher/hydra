import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, ConfirmationModal } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  countPublishedScreenshotsForGame,
  deleteMyGameScreenshots,
  isLocalScreenshotForGame,
  notifyMyGameScreenshotsChanged,
  selectPendingLocalScreenshots,
  subscribeMyGameScreenshotsChanged,
  type MyScreenshotsDeletion,
} from "@shared";
import type { GameShop } from "@types";

import {
  myGameScreenshotsApi,
  myGameScreenshotsLocal,
} from "../../game-screenshots/my-game-screenshots-bridge";

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

const hasSomethingToDelete = (
  deletion: MyScreenshotsDeletion,
  counts: MyScreenshotsCounts
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
  const [counts, setCounts] = useState<MyScreenshotsCounts>({
    local: 0,
    published: 0,
  });
  const [pending, setPending] = useState<MyScreenshotsDeletion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
    const unsubscribeLocal = window.electron.onLocalScreenshotsChange(
      (screenshots) => {
        const local = selectPendingLocalScreenshots(
          screenshots.filter((screenshot) =>
            isLocalScreenshotForGame(screenshot, shop, objectId)
          ),
          { shop, objectId }
        ).length;
        setCounts((current) => ({ ...current, local }));
      }
    );
    const unsubscribeChanged = subscribeMyGameScreenshotsChanged(
      () => void refreshCounts()
    );
    return () => {
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [objectId, refreshCounts, shop]);

  const confirm = async () => {
    if (!pending) return;
    const deletion = pending;
    setPending(null);
    setIsDeleting(true);
    const result = await deleteMyGameScreenshots(
      deletion,
      { shop, objectId },
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
    showErrorToast(
      result.errorCode === "screenshots/game-deletion-rate-limited"
        ? t("delete_screenshots_rate_limited")
        : t("delete_screenshots_failed")
    );
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
