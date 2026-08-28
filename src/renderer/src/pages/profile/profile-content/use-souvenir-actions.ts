import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  AuthPage,
  buildProfileSouvenirVisibilityPath,
  buildUserSouvenirLikePath,
  buildUserSouvenirReportPath,
  getSouvenirKey,
  normalizeSouvenirReportValues,
} from "@shared";
import type {
  ProfileSouvenir,
  ProfileVisibility,
  SouvenirReportValues,
} from "@types";

const SOUVENIR_REPORT_RESPONSE_STATUSES = [201, 400, 404, 429];

interface UseSouvenirActionsOptions {
  ownerUserId: string | undefined;
  canLike: boolean;
  canReport: boolean;
  updateSouvenir: (
    souvenirId: string,
    update: Partial<ProfileSouvenir>
  ) => void;
  removeSouvenir: (souvenirId: string) => Promise<void>;
}

export function useSouvenirActions({
  ownerUserId,
  canLike,
  canReport,
  updateSouvenir,
  removeSouvenir,
}: UseSouvenirActionsOptions) {
  const { t } = useTranslation("user_profile");
  const { showErrorToast, showSuccessToast } = useToast();
  const [likingKeys, setLikingKeys] = useState<Set<string>>(new Set());
  const [visibilityKeys, setVisibilityKeys] = useState<Set<string>>(new Set());
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  const [reportingKeys, setReportingKeys] = useState<Set<string>>(new Set());
  const [reportedKeys, setReportedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setReportingKeys(new Set());
    setReportedKeys(new Set());
  }, [ownerUserId]);

  const likeSouvenir = useCallback(
    async (souvenir: ProfileSouvenir) => {
      if (!canLike) {
        window.electron.openAuthWindow(AuthPage.SignIn);
        return;
      }

      if (!ownerUserId) return;

      const key = getSouvenirKey(souvenir.id);
      if (likingKeys.has(key)) return;

      const previousLike = {
        likeCount: souvenir.likeCount,
        likedByMe: souvenir.likedByMe,
      };
      const likedByMe = !souvenir.likedByMe;

      setLikingKeys((current) => new Set(current).add(key));
      updateSouvenir(souvenir.id, {
        likedByMe,
        likeCount: Math.max(0, souvenir.likeCount + (likedByMe ? 1 : -1)),
      });

      try {
        await window.electron.hydraApi.post(
          buildUserSouvenirLikePath(ownerUserId, souvenir.id),
          { needsAuth: true }
        );
      } catch (error) {
        updateSouvenir(souvenir.id, previousLike);
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
    async (souvenir: ProfileSouvenir) => {
      const key = getSouvenirKey(souvenir.id);
      if (visibilityKeys.has(key)) return;

      const visibility: ProfileVisibility =
        souvenir.visibility === "PRIVATE" ? "PUBLIC" : "PRIVATE";
      setVisibilityKeys((current) => new Set(current).add(key));

      try {
        await window.electron.hydraApi.patch(
          buildProfileSouvenirVisibilityPath(souvenir.id),
          { data: { visibility }, needsAuth: true }
        );

        updateSouvenir(souvenir.id, { visibility });
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
    async (souvenir: ProfileSouvenir) => {
      const key = getSouvenirKey(souvenir.id);
      if (deletingKeys.has(key)) return false;
      setDeletingKeys((current) => new Set(current).add(key));

      try {
        await window.electron.deleteAchievementSouvenir({
          souvenirId: souvenir.id,
        });

        await removeSouvenir(souvenir.id);
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

  const reportSouvenir = useCallback(
    async (souvenir: ProfileSouvenir, values: SouvenirReportValues) => {
      if (!canReport || !ownerUserId) return false;

      const key = getSouvenirKey(souvenir.id);
      if (reportingKeys.has(key) || reportedKeys.has(key)) return false;
      setReportingKeys((current) => new Set(current).add(key));

      try {
        const response = await window.electron.hydraApi.postResponse(
          buildUserSouvenirReportPath(ownerUserId, souvenir.id),
          {
            data: normalizeSouvenirReportValues(values),
            needsAuth: true,
            acceptedStatuses: SOUVENIR_REPORT_RESPONSE_STATUSES,
          }
        );

        if (response.status === 201) {
          setReportedKeys((current) => new Set(current).add(key));
          showSuccessToast(t("souvenir_reported"));
          return true;
        }

        if (response.status === 404) {
          removeSouvenir(souvenir.id);
          showErrorToast(t("souvenir_report_unavailable"));
          return true;
        }

        if (response.status === 429) {
          showErrorToast(t("souvenir_report_rate_limited"));
          return false;
        }

        showErrorToast(t("souvenir_report_failed"));
        return false;
      } catch (error) {
        logger.error("Failed to report souvenir", error);
        showErrorToast(t("souvenir_report_failed"));
        return false;
      } finally {
        setReportingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [
      ownerUserId,
      canReport,
      removeSouvenir,
      reportedKeys,
      reportingKeys,
      showErrorToast,
      showSuccessToast,
      t,
    ]
  );

  return {
    likingKeys,
    visibilityKeys,
    deletingKeys,
    reportingKeys,
    reportedKeys,
    likeSouvenir,
    changeSouvenirVisibility,
    deleteSouvenir,
    reportSouvenir,
  };
}
