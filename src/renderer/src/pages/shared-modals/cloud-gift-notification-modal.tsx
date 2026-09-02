import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { Avatar, Link } from "@renderer/components";
import { useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { levelDBService } from "@renderer/services/leveldb.service";
import {
  CLOUD_GIFT_ID_VARIABLE,
  CLOUD_GIFT_RECEIVED_NOTIFICATION,
  CLOUD_GIFT_STATUS_PENDING_ACCEPTANCE,
  NOTIFICATIONS_FETCH_FILTER,
  NOTIFICATIONS_FETCH_TAKE,
  sanitizeHtml,
} from "@shared";
import type { Notification, NotificationsResponse } from "@types";

import LogoFigma from "../../assets/cloud-gift/logo-figma.svg?react";
import raysInner from "../../assets/cloud-gift/rays-inner.png";
import raysOuter from "../../assets/cloud-gift/rays-outer.png";

import {
  CLOUD_GIFT_MODAL_OPEN_EVENT,
  type CloudGiftModalOpenDetail,
} from "./cloud-gift-modal.events";
import "./cloud-gift-notification-modal.scss";

interface CloudGiftDetails {
  durationMonths: number;
  message: string | null;
  status: string;
  buyer: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
  };
}

const OPEN_ANIMATION_DURATION = 2.912;
const PANEL_BASE_HEIGHT = 435;
const MESSAGE_BASE_HEIGHT = 88;
const MESSAGE_MAX_EXTRA_HEIGHT = 140;
const LOGO_ANIMATION_DURATION = 6;
const LOGO_SCALE_TIMES = [0, 0.1684, 1];
const RING_SCALE_TIMES = [0, 1.0104 / OPEN_ANIMATION_DURATION, 1];
const RING_MOVE_TIMES = [
  0,
  1.008 / OPEN_ANIMATION_DURATION,
  1.7028 / OPEN_ANIMATION_DURATION,
  1,
];
const PANEL_REVEAL_TIMES = [0, 1.4346 / OPEN_ANIMATION_DURATION, 1];
const figmaFirmSpring = (value: number) =>
  1 -
  Math.exp(-value * 11.1803) *
    (Math.cos(value * 0.1581) + 70.7054 * Math.sin(value * 0.1581));

const figmaSoftSpring = (value: number) =>
  1 -
  Math.exp(-value * 7.6657) *
    (Math.cos(value * 6.7605) + 1.1339 * Math.sin(value * 6.7605));

const figmaLogoSpring = (value: number) =>
  1 -
  Math.exp(-value * 8.3046) *
    (Math.cos(value * 2.7296) + 3.0424 * Math.sin(value * 2.7296));

const createRingTransition = (scaleEase: (value: number) => number) => ({
  rotate: {
    duration: OPEN_ANIMATION_DURATION,
    times: RING_SCALE_TIMES,
    ease: [figmaFirmSpring, "linear" as const],
  },
  scaleX: {
    duration: OPEN_ANIMATION_DURATION,
    times: RING_SCALE_TIMES,
    ease: [scaleEase, "linear" as const],
  },
  scaleY: {
    duration: OPEN_ANIMATION_DURATION,
    times: RING_SCALE_TIMES,
    ease: [scaleEase, "linear" as const],
  },
  y: {
    duration: OPEN_ANIMATION_DURATION,
    times: RING_MOVE_TIMES,
    ease: ["linear" as const, figmaFirmSpring, "linear" as const],
  },
});

const getSuppressionKey = (giftId: string) =>
  `cloudGiftModalSuppressed:${giftId}`;

export function CloudGiftNotificationModal() {
  const { t } = useTranslation("notifications_page");
  const { userDetails, fetchUserDetails, updateUserDetails } = useUserDetails();
  const shouldReduceMotion = useReducedMotion();
  const headingId = useId();
  const messageId = useId();
  const isCheckingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const messageRef = useRef<HTMLDivElement | null>(null);
  const acceptButtonRef = useRef<HTMLButtonElement | null>(null);
  const dismissedGiftIdsRef = useRef(new Set<string>());
  const activeGiftIdRef = useRef<string | null>(null);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [gift, setGift] = useState<CloudGiftDetails | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRevealComplete, setIsRevealComplete] = useState(false);
  const [messageHeightExtra, setMessageHeightExtra] = useState(0);

  const panelHeight = PANEL_BASE_HEIGHT + messageHeightExtra;

  const findPendingGift = useCallback(async () => {
    if (!userDetails || isCheckingRef.current || notification) return;

    isCheckingRef.current = true;

    try {
      const response =
        await window.electron.hydraApi.get<NotificationsResponse>(
          "/profile/notifications",
          {
            params: {
              filter: NOTIFICATIONS_FETCH_FILTER,
              take: NOTIFICATIONS_FETCH_TAKE,
              skip: 0,
            },
            needsAuth: true,
          }
        );

      const giftNotifications = response.notifications.filter(
        (item) =>
          item.type === CLOUD_GIFT_RECEIVED_NOTIFICATION &&
          item.variables[CLOUD_GIFT_ID_VARIABLE]
      );

      for (const item of giftNotifications) {
        const giftId = item.variables[CLOUD_GIFT_ID_VARIABLE];
        if (dismissedGiftIdsRef.current.has(giftId)) continue;

        const isSuppressed = await levelDBService.get(
          getSuppressionKey(giftId),
          null,
          "json"
        );

        if (isSuppressed) continue;

        const giftDetails = await window.electron.hydraApi
          .get<CloudGiftDetails>(`/cloud-gifts/${giftId}`, {
            needsAuth: true,
          })
          .catch(() => null);

        if (
          giftDetails?.status === CLOUD_GIFT_STATUS_PENDING_ACCEPTANCE &&
          !activeGiftIdRef.current &&
          !dismissedGiftIdsRef.current.has(giftId)
        ) {
          setGift(giftDetails);
          setNotification(item);
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

  useEffect(() => {
    const unsubscribe = window.electron.onCloudGiftResolved(
      (resolvedGiftId) => {
        dismissedGiftIdsRef.current.add(resolvedGiftId);

        if (
          notification &&
          notification.variables[CLOUD_GIFT_ID_VARIABLE] === resolvedGiftId
        ) {
          activeGiftIdRef.current = null;
          setNotification(null);
          setGift(null);
        }
      }
    );

    return () => unsubscribe();
  }, [notification]);

  useEffect(() => {
    const onOpenGiftModal = (event: Event) => {
      const { notification: requestedNotification } = (
        event as CustomEvent<CloudGiftModalOpenDetail>
      ).detail;
      const giftId = requestedNotification.variables[CLOUD_GIFT_ID_VARIABLE];

      if (
        requestedNotification.type !== CLOUD_GIFT_RECEIVED_NOTIFICATION ||
        !giftId
      ) {
        return;
      }

      activeGiftIdRef.current = giftId;
      setGift(null);
      setNotification(requestedNotification);

      void window.electron.hydraApi
        .get<CloudGiftDetails>(`/cloud-gifts/${giftId}`, {
          needsAuth: true,
        })
        .then((giftDetails) => {
          if (activeGiftIdRef.current !== giftId) return;

          if (giftDetails.status === CLOUD_GIFT_STATUS_PENDING_ACCEPTANCE) {
            setGift(giftDetails);
            return;
          }

          activeGiftIdRef.current = null;
          setNotification(null);
          void window.electron.openCheckout({
            path: `/gifts/${giftId}`,
          });
        })
        .catch((error) => {
          if (activeGiftIdRef.current !== giftId) return;

          logger.error("Failed to open Cloud Gift modal", error);
          activeGiftIdRef.current = null;
          setNotification(null);
        });
    };

    window.addEventListener(CLOUD_GIFT_MODAL_OPEN_EVENT, onOpenGiftModal);

    return () => {
      window.removeEventListener(CLOUD_GIFT_MODAL_OPEN_EVENT, onOpenGiftModal);
    };
  }, []);

  const dismissCurrentGift = useCallback(() => {
    activeGiftIdRef.current = null;

    if (notification) {
      const giftId = notification.variables[CLOUD_GIFT_ID_VARIABLE];
      dismissedGiftIdsRef.current.add(giftId);
      void window.electron.notifyCloudGiftResolved(giftId);
    }

    setNotification(null);
    setGift(null);
  }, [notification]);

  const acceptGift = useCallback(async () => {
    if (!notification || isAccepting) return;

    const giftId = notification.variables[CLOUD_GIFT_ID_VARIABLE];
    setIsAccepting(true);

    try {
      await window.electron.hydraApi.post(`/cloud-gifts/${giftId}/accept`, {
        needsAuth: true,
      });

      dismissCurrentGift();

      void fetchUserDetails()
        .then((details) => {
          if (details) return updateUserDetails(details);
          return undefined;
        })
        .catch((error) => {
          logger.error(
            "Failed to refresh user after accepting Cloud Gift",
            error
          );
        });

      await window.electron.openCheckout({ path: `/gifts/${giftId}` });
    } catch (error) {
      logger.error("Failed to accept Cloud Gift", error);
    } finally {
      setIsAccepting(false);
    }
  }, [
    dismissCurrentGift,
    fetchUserDetails,
    isAccepting,
    notification,
    updateUserDetails,
  ]);

  const isVisible = Boolean(notification && gift);

  const isTopMostDialog = useCallback(() => {
    const openDialogs = document.querySelectorAll<HTMLElement>(
      '[role="dialog"]:not([aria-hidden="true"])'
    );

    return (
      openDialogs.length > 0 &&
      openDialogs[openDialogs.length - 1] === dialogRef.current
    );
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const previouslyFocusedElement = document.activeElement as HTMLElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopMostDialog()) {
        dismissCurrentGift();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocusedElement?.focus();
    };
  }, [dismissCurrentGift, isTopMostDialog, isVisible]);

  useEffect(() => {
    setIsRevealComplete(Boolean(isVisible && shouldReduceMotion));
  }, [isVisible, shouldReduceMotion]);

  useEffect(() => {
    if (isRevealComplete) {
      acceptButtonRef.current?.focus();
    }
  }, [isRevealComplete]);

  useLayoutEffect(() => {
    const messageElement = messageRef.current;
    const nextHeight = messageElement
      ? Math.min(
          MESSAGE_MAX_EXTRA_HEIGHT,
          Math.max(0, messageElement.clientHeight - MESSAGE_BASE_HEIGHT)
        )
      : 0;

    setMessageHeightExtra(nextHeight);
  }, [gift?.message]);

  return createPortal(
    <AnimatePresence>
      {notification && gift && (
        <motion.div
          key={notification.variables[CLOUD_GIFT_ID_VARIABLE]}
          className="cloud-gift-notification-modal__overlay"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && isTopMostDialog()) {
              dismissCurrentGift();
            }
          }}
        >
          <div
            ref={dialogRef}
            className="cloud-gift-notification-modal__stage"
            style={{ top: -messageHeightExtra / 2 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            aria-describedby={gift.message ? messageId : undefined}
            aria-busy={!isRevealComplete}
            data-reveal-complete={isRevealComplete}
            data-hydra-dialog
          >
            {[raysOuter, raysInner].map((source, index) => (
              <motion.div
                key={source}
                className={`cloud-gift-notification-modal__rays cloud-gift-notification-modal__rays--${
                  index === 0 ? "outer" : "inner"
                }`}
                initial={
                  shouldReduceMotion
                    ? false
                    : { rotate: -66.482, scaleX: 0.546, scaleY: 0.546, y: 0 }
                }
                animate={
                  shouldReduceMotion
                    ? { rotate: 0, scaleX: 1, scaleY: 1, y: -120 }
                    : {
                        rotate: [-66.482, 0, 0],
                        scaleX: [0.546, 1, 1],
                        scaleY: [0.546, 1, 1],
                        y: [0, 0, -120, -120],
                      }
                }
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : createRingTransition(
                        index === 0 ? figmaFirmSpring : figmaSoftSpring
                      )
                }
                aria-hidden="true"
              >
                <img src={source} alt="" />
              </motion.div>
            ))}

            <motion.section
              className="cloud-gift-notification-modal__panel"
              initial={shouldReduceMotion ? false : { height: 1, opacity: 0 }}
              animate={
                shouldReduceMotion
                  ? { height: panelHeight, opacity: 1 }
                  : {
                      height: [1, 1, panelHeight],
                      opacity: [0, 0, 1],
                    }
              }
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : {
                      height: {
                        duration: OPEN_ANIMATION_DURATION,
                        times: PANEL_REVEAL_TIMES,
                        ease: ["linear", figmaFirmSpring],
                      },
                      opacity: {
                        duration: OPEN_ANIMATION_DURATION,
                        times: PANEL_REVEAL_TIMES,
                        ease: ["linear", figmaFirmSpring],
                      },
                    }
              }
              onAnimationComplete={() => setIsRevealComplete(true)}
            >
              <div
                className="cloud-gift-notification-modal__panel-content"
                style={{ height: panelHeight }}
              >
                <div className="cloud-gift-notification-modal__body">
                  <h2
                    id={headingId}
                    className="cloud-gift-notification-modal__title"
                  >
                    {t("cloud_gift_received_title", {
                      count: gift.durationMonths,
                    })}
                  </h2>

                  {gift.message && (
                    <div
                      ref={messageRef}
                      id={messageId}
                      className="cloud-gift-notification-modal__message-card"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(gift.message),
                      }}
                    />
                  )}

                  <Link
                    className="cloud-gift-notification-modal__sender"
                    to={`/profile/${gift.buyer.id}`}
                    onClick={dismissCurrentGift}
                  >
                    <Avatar
                      size={40}
                      src={gift.buyer.profileImageUrl}
                      alt={gift.buyer.displayName}
                    />
                    <span>{gift.buyer.displayName}</span>
                  </Link>
                </div>

                <button
                  ref={acceptButtonRef}
                  type="button"
                  className="cloud-gift-notification-modal__accept"
                  disabled={!isRevealComplete || isAccepting}
                  tabIndex={isRevealComplete ? 0 : -1}
                  onClick={() => void acceptGift()}
                >
                  {t("cloud_gift_launcher_accept")}
                </button>
              </div>
            </motion.section>

            <motion.div
              className="cloud-gift-notification-modal__logo"
              initial={
                shouldReduceMotion
                  ? false
                  : { scaleX: 0.08, scaleY: 0.08, y: 0 }
              }
              animate={
                shouldReduceMotion
                  ? { scaleX: 1, scaleY: 1, y: -120 }
                  : {
                      scaleX: [0.08, 1, 1],
                      scaleY: [0.08, 1, 1],
                      y: [0, 0, -120, -120],
                    }
              }
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : {
                      scaleX: {
                        duration: LOGO_ANIMATION_DURATION,
                        times: LOGO_SCALE_TIMES,
                        ease: [figmaLogoSpring, "linear"],
                      },
                      scaleY: {
                        duration: LOGO_ANIMATION_DURATION,
                        times: LOGO_SCALE_TIMES,
                        ease: [figmaLogoSpring, "linear"],
                      },
                      y: {
                        duration: OPEN_ANIMATION_DURATION,
                        times: RING_MOVE_TIMES,
                        ease: ["linear", figmaFirmSpring, "linear"],
                      },
                    }
              }
              aria-hidden="true"
              data-node-id="7087:26039"
              data-reduced-motion={shouldReduceMotion}
            >
              <LogoFigma className="cloud-gift-notification-modal__logo-art" />
              {!shouldReduceMotion && (
                <span className="cloud-gift-notification-modal__logo-shine" />
              )}
            </motion.div>

            <button
              type="button"
              className="cloud-gift-notification-modal__decide-later"
              style={{ top: `calc(50% + ${331 + messageHeightExtra}px)` }}
              data-visible={isRevealComplete}
              tabIndex={isRevealComplete ? 0 : -1}
              onClick={dismissCurrentGift}
            >
              {t("cloud_gift_launcher_decide_later")}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
