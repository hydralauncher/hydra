import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Notification, NotificationsResponse } from "@types";
import { IS_DESKTOP } from "../constants";
import { useDate, useUserDetails } from "../hooks";
import {
  Button,
  Checkbox,
  HorizontalFocusGroup,
  Modal,
  UserProfileAvatar,
  VerticalFocusGroup,
} from "./common";

import "./cloud-gift-notification-modal.scss";

interface CloudGiftDetails {
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

const OPEN_GIFT_FOCUS_ID = "cloud-gift-modal-open";
const BUYER_PROFILE_FOCUS_ID = "cloud-gift-modal-buyer-profile";
const SUPPRESS_GIFT_FOCUS_ID = "cloud-gift-modal-suppress";
const CANCEL_GIFT_FOCUS_ID = "cloud-gift-modal-cancel";
const CONTENT_REGION_ID = "cloud-gift-modal-content";
const ACTIONS_REGION_ID = "cloud-gift-modal-actions";
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
        await globalThis.window.electron.hydraApi.get<NotificationsResponse>(
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

        const isSuppressed = await globalThis.window.electron.leveldb.get(
          getSuppressionKey(giftId),
          null,
          "json"
        );

        if (isSuppressed) continue;

        const gift = await globalThis.window.electron.hydraApi
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
      console.error("Failed to check Cloud Gift notifications", error);
    } finally {
      isCheckingRef.current = false;
    }
  }, [notification, userDetails]);

  useEffect(() => {
    void findPendingGift();
  }, [findPendingGift]);

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onSyncNotificationCount(
      () => {
        void findPendingGift();
      }
    );

    return () => unsubscribe();
  }, [findPendingGift]);

  const suppressIfRequested = useCallback(async () => {
    if (!notification || !doNotShowAgain) return;

    await globalThis.window.electron.leveldb
      .put(getSuppressionKey(notification.variables.giftId), true, null, "json")
      .catch((error) => {
        console.error("Failed to suppress Cloud Gift modal", error);
      });
  }, [doNotShowAgain, notification]);

  const closeModal = useCallback(async () => {
    await suppressIfRequested();

    if (notification) {
      dismissedGiftIdsRef.current.add(notification.variables.giftId);
    }

    setNotification(null);
    setGift(null);
  }, [notification, suppressIfRequested]);

  const openGift = useCallback(async () => {
    if (!notification) return;

    await suppressIfRequested();
    await globalThis.window.electron.openCheckout({
      path: `/gifts/${notification.variables.giftId}`,
    });
    dismissedGiftIdsRef.current.add(notification.variables.giftId);
    setNotification(null);
    setGift(null);
  }, [notification, suppressIfRequested]);

  const buyerProfilePath = gift
    ? `${IS_DESKTOP ? "/big-picture" : ""}/profile/${gift.buyer.id}`
    : undefined;

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
      initialFocusId={OPEN_GIFT_FOCUS_ID}
      className="big-picture-cloud-gift-notification-modal"
    >
      <VerticalFocusGroup
        regionId={CONTENT_REGION_ID}
        className="big-picture-cloud-gift-notification-modal__content"
        style={{ gap: 24 }}
      >
        {gift && (
          <>
            {gift.message ? (
              <blockquote className="big-picture-cloud-gift-notification-modal__message-card">
                <div className="big-picture-cloud-gift-notification-modal__message-avatar">
                  <UserProfileAvatar
                    image={gift.buyer.profileImageUrl}
                    alt={gift.buyer.displayName}
                    className="big-picture-cloud-gift-notification-modal__buyer-avatar"
                    fallbackClassName="big-picture-cloud-gift-notification-modal__buyer-avatar--fallback"
                    width={48}
                    height={48}
                    iconSize={30}
                  />
                </div>

                <p className="big-picture-cloud-gift-notification-modal__message">
                  “{gift.message}”
                </p>
                <footer className="big-picture-cloud-gift-notification-modal__signature">
                  —{" "}
                  <Button
                    variant="link"
                    focusId={BUYER_PROFILE_FOCUS_ID}
                    href={buyerProfilePath}
                    className="big-picture-cloud-gift-notification-modal__profile-link"
                    onClick={() => void closeModal()}
                  >
                    {gift.buyer.displayName}
                  </Button>
                </footer>
              </blockquote>
            ) : (
              <div className="big-picture-cloud-gift-notification-modal__sender">
                <UserProfileAvatar
                  image={gift.buyer.profileImageUrl}
                  alt={gift.buyer.displayName}
                  className="big-picture-cloud-gift-notification-modal__buyer-avatar"
                  fallbackClassName="big-picture-cloud-gift-notification-modal__buyer-avatar--fallback"
                  width={48}
                  height={48}
                  iconSize={30}
                />
                <Button
                  variant="link"
                  focusId={BUYER_PROFILE_FOCUS_ID}
                  href={buyerProfilePath}
                  className="big-picture-cloud-gift-notification-modal__profile-link"
                  onClick={() => void closeModal()}
                >
                  {gift.buyer.displayName}
                </Button>
              </div>
            )}

            {gift.claimExpiresAt && (
              <p className="big-picture-cloud-gift-notification-modal__deadline">
                {t("cloud_gift_deadline", {
                  date: formatDate(gift.claimExpiresAt),
                })}
              </p>
            )}
          </>
        )}

        <div className="big-picture-cloud-gift-notification-modal__preference">
          <Checkbox
            focusId={SUPPRESS_GIFT_FOCUS_ID}
            checked={doNotShowAgain}
            onChange={setDoNotShowAgain}
            label={t("cloud_gift_do_not_show_again")}
          />
        </div>

        <HorizontalFocusGroup
          regionId={ACTIONS_REGION_ID}
          className="big-picture-cloud-gift-notification-modal__actions"
        >
          <Button
            variant="secondary"
            focusId={CANCEL_GIFT_FOCUS_ID}
            onClick={() => void closeModal()}
          >
            {t("cloud_gift_cancel")}
          </Button>
          <Button focusId={OPEN_GIFT_FOCUS_ID} onClick={() => void openGift()}>
            {t("cloud_gift_open")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
