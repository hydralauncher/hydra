import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Avatar,
  Button,
  CheckboxField,
  Link,
  Modal,
} from "@renderer/components";
import { useDate, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { Notification, NotificationsResponse } from "@types";

import "./cloud-gift-notification-modal.scss";

interface CloudGiftDetails {
  id: string;
  durationMonths: number;
  message: string | null;
  claimExpiresAt: string | null;
  status: string;
  buyer: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
  };
}

const getSuppressionKey = (giftId: string) =>
  `cloudGiftModalSuppressed:${giftId}`;

export function CloudGiftNotificationModal() {
  const { t } = useTranslation("notifications_page");
  const { formatDate } = useDate();
  const { userDetails } = useUserDetails();
  const isCheckingRef = useRef(false);
  const dismissedGiftIdsRef = useRef(new Set<string>());
  const [notification, setNotification] = useState<Notification | null>(null);
  const [gift, setGift] = useState<CloudGiftDetails | null>(null);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);

  const findPendingGift = useCallback(async () => {
    if (!userDetails || isCheckingRef.current || notification) return;

    isCheckingRef.current = true;

    try {
      const response =
        await window.electron.hydraApi.get<NotificationsResponse>(
          "/profile/notifications",
          {
            params: { filter: "all", take: 20, skip: 0 },
            needsAuth: true,
          }
        );

      const giftNotifications = response.notifications.filter(
        (item) => item.type === "CLOUD_GIFT_RECEIVED" && item.variables.giftId
      );

      for (const item of giftNotifications) {
        const giftId = item.variables.giftId;
        if (dismissedGiftIdsRef.current.has(giftId)) continue;

        const isSuppressed = await levelDBService.get(
          getSuppressionKey(giftId),
          null,
          "json"
        );

        if (isSuppressed) continue;

        const gift = await window.electron.hydraApi
          .get<CloudGiftDetails>(`/cloud-gifts/${giftId}`, {
            needsAuth: true,
          })
          .catch(() => null);

        if (gift?.status === "PENDING_ACCEPTANCE") {
          setGift(gift);
          setNotification(item);
          setDoNotShowAgain(false);
          break;
        }
      }
    } catch (error) {
      logger.error("Failed to check Cloud Gift notifications", error);
    } finally {
      isCheckingRef.current = false;
    }
  }, [notification, userDetails]);

  useEffect(() => {
    void findPendingGift();
  }, [findPendingGift]);

  useEffect(() => {
    const unsubscribe = window.electron.onSyncNotificationCount(() => {
      void findPendingGift();
    });

    return () => unsubscribe();
  }, [findPendingGift]);

  const closeModal = useCallback(async () => {
    if (notification && doNotShowAgain) {
      await levelDBService
        .put(
          getSuppressionKey(notification.variables.giftId),
          true,
          null,
          "json"
        )
        .catch((error) => {
          logger.error("Failed to suppress Cloud Gift modal", error);
        });
    }

    if (notification) {
      dismissedGiftIdsRef.current.add(notification.variables.giftId);
    }

    setNotification(null);
    setGift(null);
  }, [doNotShowAgain, notification]);

  const openGift = useCallback(async () => {
    if (!notification) return;

    if (doNotShowAgain) {
      await levelDBService
        .put(
          getSuppressionKey(notification.variables.giftId),
          true,
          null,
          "json"
        )
        .catch((error) => {
          logger.error("Failed to suppress Cloud Gift modal", error);
        });
    }

    await window.electron.openCheckout({
      path: `/gifts/${notification.variables.giftId}`,
    });
    dismissedGiftIdsRef.current.add(notification.variables.giftId);
    setNotification(null);
    setGift(null);
  }, [doNotShowAgain, notification]);

  return (
    <Modal
      visible={Boolean(notification)}
      title={t("cloud_gift_modal_title")}
      description={
        gift
          ? t("cloud_gift_modal_description", {
              displayName: gift.buyer.displayName,
              count: gift.durationMonths,
            })
          : undefined
      }
      onClose={() => void closeModal()}
    >
      <div className="cloud-gift-notification-modal">
        {gift && (
          <>
            {gift.message ? (
              <blockquote className="cloud-gift-notification-modal__message-card">
                <div className="cloud-gift-notification-modal__message-avatar">
                  <Avatar
                    size={40}
                    src={gift.buyer.profileImageUrl}
                    alt={gift.buyer.displayName}
                  />
                </div>

                <p className="cloud-gift-notification-modal__message">
                  “{gift.message}”
                </p>
                <footer className="cloud-gift-notification-modal__signature">
                  —{" "}
                  <Link
                    to={`/profile/${gift.buyer.id}`}
                    onClick={() => void closeModal()}
                  >
                    {gift.buyer.displayName}
                  </Link>
                </footer>
              </blockquote>
            ) : (
              <div className="cloud-gift-notification-modal__sender">
                <Avatar
                  size={40}
                  src={gift.buyer.profileImageUrl}
                  alt={gift.buyer.displayName}
                />
                <Link
                  to={`/profile/${gift.buyer.id}`}
                  onClick={() => void closeModal()}
                >
                  {gift.buyer.displayName}
                </Link>
              </div>
            )}

            {gift.claimExpiresAt && (
              <p className="cloud-gift-notification-modal__deadline">
                {t("cloud_gift_deadline", {
                  date: formatDate(gift.claimExpiresAt),
                })}
              </p>
            )}
          </>
        )}

        <div className="cloud-gift-notification-modal__preference">
          <CheckboxField
            checked={doNotShowAgain}
            onChange={(event) => setDoNotShowAgain(event.target.checked)}
            label={t("cloud_gift_do_not_show_again")}
          />
        </div>

        <div className="cloud-gift-notification-modal__actions">
          <Button theme="outline" onClick={() => void closeModal()}>
            {t("cloud_gift_cancel")}
          </Button>
          <Button onClick={() => void openGift()}>
            {t("cloud_gift_open")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
