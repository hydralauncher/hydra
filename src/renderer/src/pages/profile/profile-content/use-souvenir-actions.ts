import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  AuthPage,
  buildProfileSouvenirVisibilityPath,
  buildUserSouvenirLikePath,
  getSouvenirKey,
} from "@shared";
import type { ProfileAchievement, ProfileVisibility } from "@types";

interface UseSouvenirActionsOptions {
  ownerUserId: string | undefined;
  canLike: boolean;
  updateSouvenir: (
    gameId: string,
    name: string,
    update: Partial<ProfileAchievement>
  ) => void;
  removeSouvenir: (gameId: string, name: string) => void;
}

export function useSouvenirActions({
  ownerUserId,
  canLike,
  updateSouvenir,
  removeSouvenir,
}: UseSouvenirActionsOptions) {
  const { t } = useTranslation("user_profile");
  const { showErrorToast, showSuccessToast } = useToast();
  const [likingKeys, setLikingKeys] = useState<Set<string>>(new Set());
  const [visibilityKeys, setVisibilityKeys] = useState<Set<string>>(new Set());
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());

  const likeSouvenir = useCallback(
    async (souvenir: ProfileAchievement) => {
      if (!canLike) {
        window.electron.openAuthWindow(AuthPage.SignIn);
        return;
      }

      if (!ownerUserId) return;

      const key = getSouvenirKey(souvenir.gameId, souvenir.name);
      if (likingKeys.has(key)) return;

      const previousLike = {
        likeCount: souvenir.likeCount,
        likedByMe: souvenir.likedByMe,
      };
      const likedByMe = !souvenir.likedByMe;

      setLikingKeys((current) => new Set(current).add(key));
      updateSouvenir(souvenir.gameId, souvenir.name, {
        likedByMe,
        likeCount: Math.max(0, souvenir.likeCount + (likedByMe ? 1 : -1)),
      });

      try {
        await window.electron.hydraApi.put(
          buildUserSouvenirLikePath(
            ownerUserId,
            souvenir.gameId,
            souvenir.name
          ),
          { needsAuth: true }
        );
      } catch (error) {
        updateSouvenir(souvenir.gameId, souvenir.name, previousLike);
        logger.error("Failed to like souvenir", error);
        showErrorToast(t("souvenir_like_failed"));
      } finally {
        setLikingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [canLike, likingKeys, ownerUserId, showErrorToast, t, updateSouvenir]
  );

  const changeSouvenirVisibility = useCallback(
    async (souvenir: ProfileAchievement) => {
      const key = getSouvenirKey(souvenir.gameId, souvenir.name);
      if (visibilityKeys.has(key)) return;

      const visibility: ProfileVisibility =
        souvenir.visibility === "PRIVATE" ? "PUBLIC" : "PRIVATE";
      setVisibilityKeys((current) => new Set(current).add(key));

      try {
        await window.electron.hydraApi.patch(
          buildProfileSouvenirVisibilityPath(souvenir.gameId, souvenir.name),
          { data: { visibility }, needsAuth: true }
        );

        updateSouvenir(souvenir.gameId, souvenir.name, { visibility });
        showSuccessToast(
          t(
            visibility === "PRIVATE"
              ? "souvenir_hidden_successfully"
              : "souvenir_shown_successfully"
          )
        );
      } catch (error) {
        logger.error("Failed to update souvenir visibility", error);
        showErrorToast(t("souvenir_visibility_failed"));
      } finally {
        setVisibilityKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [showErrorToast, showSuccessToast, t, updateSouvenir, visibilityKeys]
  );

  const deleteSouvenir = useCallback(
    async (souvenir: ProfileAchievement) => {
      const key = getSouvenirKey(souvenir.gameId, souvenir.name);
      if (deletingKeys.has(key)) return false;
      setDeletingKeys((current) => new Set(current).add(key));

      try {
        await window.electron.deleteAchievementSouvenir({
          gameId: souvenir.gameId,
          achievementName: souvenir.name,
          gameTitle: souvenir.gameTitle,
          achievementDisplayName: souvenir.displayName,
        });

        removeSouvenir(souvenir.gameId, souvenir.name);
        showSuccessToast(t("souvenir_deleted_successfully"));
        return true;
      } catch (error) {
        logger.error("Failed to delete souvenir", error);
        showErrorToast(t("souvenir_deletion_failed"));
        return false;
      } finally {
        setDeletingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [deletingKeys, removeSouvenir, showErrorToast, showSuccessToast, t]
  );

  return {
    likingKeys,
    visibilityKeys,
    deletingKeys,
    likeSouvenir,
    changeSouvenirVisibility,
    deleteSouvenir,
  };
}
