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

import LogoFigma from "@renderer/assets/cloud-gift/logo-figma.svg?react";
import raysInner from "@renderer/assets/cloud-gift/rays-inner.png";
import raysOuter from "@renderer/assets/cloud-gift/rays-outer.png";
import { logger } from "@renderer/logger";
import {
  CLOUD_GIFT_ID_VARIABLE,
  CLOUD_GIFT_RECEIVED_NOTIFICATION,
  CLOUD_GIFT_STATUS_PENDING_ACCEPTANCE,
  NOTIFICATIONS_FETCH_FILTER,
  NOTIFICATIONS_FETCH_TAKE,
  sanitizeHtml,
} from "@shared";
import type { Notification, NotificationsResponse } from "@types";
import { IS_BROWSER, IS_DESKTOP } from "../constants";
import {
  useNavigationActions,
  useNavigationScreenActions,
  useUserDetails,
} from "../hooks";
import {
  Button,
  FocusItem,
  NavigationLayer,
  UserProfileAvatar,
  VerticalFocusGroup,
} from "./common";
import { useNavigationStore } from "../stores";
import {
  BIG_PICTURE_CLOUD_GIFT_MODAL_OPEN_EVENT,
  type BigPictureCloudGiftModalOpenDetail,
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

const ACCEPT_GIFT_FOCUS_ID = "big-picture-cloud-gift-modal-accept";
const BUYER_PROFILE_FOCUS_ID = "big-picture-cloud-gift-modal-buyer-profile";
const DECIDE_LATER_FOCUS_ID = "big-picture-cloud-gift-modal-decide-later";
const MESSAGE_FOCUS_ID = "big-picture-cloud-gift-modal-message";
const CONTENT_REGION_ID = "big-picture-cloud-gift-modal-content";

const MESSAGE_SCROLL_STEP = 96;

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

export function CloudGiftNotificationModal() {
  const { t } = useTranslation("notifications_page");
  const { userDetails, fetchUserDetails } = useUserDetails();
  const { moveFocus } = useNavigationActions();
  const shouldReduceMotion = useReducedMotion();
  const headingId = useId();
  const isCheckingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const messageRef = useRef<HTMLDivElement | null>(null);
  const dismissedGiftIdsRef = useRef(new Set<string>());
  const activeGiftIdRef = useRef<string | null>(null);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [gift, setGift] = useState<CloudGiftDetails | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRevealComplete, setIsRevealComplete] = useState(false);
  const [messageHeightExtra, setMessageHeightExtra] = useState(0);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);

  const panelHeight = PANEL_BASE_HEIGHT + messageHeightExtra;
  const isVisible = Boolean(notification && gift);
  const messageFocused = isVisible && currentFocusId === MESSAGE_FOCUS_ID;

  const findPendingGift = useCallback(async () => {
    if (!userDetails || isCheckingRef.current || notification) return;

    isCheckingRef.current = true;

    try {
      const response =
        await globalThis.window.electron.hydraApi.get<NotificationsResponse>(
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

        const giftDetails = await globalThis.window.electron.hydraApi
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
      logger.error(
        "Failed to check Big Picture Cloud Gift notifications",
        error
      );
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

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onCloudGiftResolved(
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
        event as CustomEvent<BigPictureCloudGiftModalOpenDetail>
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

      void globalThis.window.electron.hydraApi
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
          void globalThis.window.electron.openCheckout({
            path: `/gifts/${giftId}`,
          });
        })
        .catch((error) => {
          if (activeGiftIdRef.current !== giftId) return;

          logger.error("Failed to open Big Picture Cloud Gift modal", error);
          activeGiftIdRef.current = null;
          setNotification(null);
        });
    };

    globalThis.window.addEventListener(
      BIG_PICTURE_CLOUD_GIFT_MODAL_OPEN_EVENT,
      onOpenGiftModal
    );

    return () => {
      globalThis.window.removeEventListener(
        BIG_PICTURE_CLOUD_GIFT_MODAL_OPEN_EVENT,
        onOpenGiftModal
      );
    };
  }, []);

  const dismissCurrentGift = useCallback(() => {
    activeGiftIdRef.current = null;

    if (notification) {
      const giftId = notification.variables[CLOUD_GIFT_ID_VARIABLE];
      dismissedGiftIdsRef.current.add(giftId);
      void globalThis.window.electron.notifyCloudGiftResolved(giftId);
    }

    setNotification(null);
    setGift(null);
  }, [notification]);

  const acceptGift = useCallback(async () => {
    if (!notification || isAccepting) return;

    const giftId = notification.variables[CLOUD_GIFT_ID_VARIABLE];
    setIsAccepting(true);

    try {
      await globalThis.window.electron.hydraApi.post(
        `/cloud-gifts/${giftId}/accept`,
        { needsAuth: true }
      );

      dismissCurrentGift();
      void fetchUserDetails().catch((error) => {
        logger.error(
          "Failed to refresh Big Picture user after accepting Cloud Gift",
          error
        );
      });

      await globalThis.window.electron.openCheckout({
        path: `/gifts/${giftId}`,
      });
    } catch (error) {
      logger.error("Failed to accept Big Picture Cloud Gift", error);
    } finally {
      setIsAccepting(false);
    }
  }, [dismissCurrentGift, fetchUserDetails, isAccepting, notification]);

  const isTopMostDialog = useCallback(() => {
    const openDialogs = document.querySelectorAll<HTMLElement>(
      '[role="dialog"]:not([aria-hidden="true"])'
    );

    return (
      openDialogs.length > 0 &&
      openDialogs[openDialogs.length - 1] === dialogRef.current
    );
  }, []);

  const closeTopMostDialog = useCallback(() => {
    if (!isTopMostDialog()) return;
    dismissCurrentGift();
  }, [dismissCurrentGift, isTopMostDialog]);

  const scrollMessageStep = useCallback(
    (direction: "up" | "down") => {
      const element = messageRef.current;

      if (!element) {
        moveFocus(direction);
        return;
      }

      const previousScrollTop = element.scrollTop;
      const maxScrollTop = element.scrollHeight - element.clientHeight;

      if (direction === "down") {
        if (maxScrollTop <= 0) {
          moveFocus("down");
          return;
        }

        element.scrollTop = Math.min(
          maxScrollTop,
          previousScrollTop + MESSAGE_SCROLL_STEP
        );
      } else {
        if (previousScrollTop <= 0) {
          moveFocus("up");
          return;
        }

        element.scrollTop = Math.max(
          0,
          previousScrollTop - MESSAGE_SCROLL_STEP
        );
      }

      if (element.scrollTop === previousScrollTop) {
        moveFocus(direction);
      }
    },
    [moveFocus]
  );

  useNavigationScreenActions(
    isVisible
      ? {
          press: { b: closeTopMostDialog },
          direction: messageFocused
            ? {
                down: () => scrollMessageStep("down"),
                up: () => scrollMessageStep("up"),
              }
            : {},
        }
      : {}
  );

  useEffect(() => {
    if (!isVisible) return;

    const previouslyFocusedElement = document.activeElement as HTMLElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      closeTopMostDialog();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.window.removeEventListener("keydown", onKeyDown);
      previouslyFocusedElement?.focus();
    };
  }, [closeTopMostDialog, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      setIsRevealComplete(false);
      return;
    }

    setIsRevealComplete(Boolean(shouldReduceMotion));
  }, [
    isVisible,
    notification?.variables[CLOUD_GIFT_ID_VARIABLE],
    shouldReduceMotion,
  ]);

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

  const buyerProfilePath = gift
    ? `${IS_DESKTOP ? "/big-picture" : ""}/profile/${gift.buyer.id}`
    : undefined;

  if (!IS_BROWSER) return null;

  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  return createPortal(
    <AnimatePresence>
      {notification && gift && (
        <motion.div
          key={notification.variables[CLOUD_GIFT_ID_VARIABLE]}
          className="big-picture-cloud-gift-notification-modal__overlay"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeTopMostDialog();
          }}
        >
          <NavigationLayer
            rootRegionId={CONTENT_REGION_ID}
            initialFocusId={ACCEPT_GIFT_FOCUS_ID}
          >
            <VerticalFocusGroup regionId={CONTENT_REGION_ID} asChild>
              <div
                ref={dialogRef}
                className="big-picture-cloud-gift-notification-modal__stage"
                style={{ top: -messageHeightExtra / 2 }}
                role="dialog"
                aria-modal="true"
                aria-labelledby={headingId}
                aria-describedby={gift.message ? MESSAGE_FOCUS_ID : undefined}
                aria-busy={!isRevealComplete}
                data-reveal-complete={isRevealComplete}
                data-hydra-dialog
              >
                {[raysOuter, raysInner].map((source, index) => (
                  <motion.div
                    key={source}
                    className={`big-picture-cloud-gift-notification-modal__rays big-picture-cloud-gift-notification-modal__rays--${
                      index === 0 ? "outer" : "inner"
                    }`}
                    initial={
                      shouldReduceMotion
                        ? false
                        : {
                            rotate: -66.482,
                            scaleX: 0.546,
                            scaleY: 0.546,
                            y: 0,
                          }
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
                  className="big-picture-cloud-gift-notification-modal__panel"
                  initial={
                    shouldReduceMotion ? false : { height: 1, opacity: 0 }
                  }
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
                    className="big-picture-cloud-gift-notification-modal__panel-content"
                    style={{ height: panelHeight }}
                  >
                    <div className="big-picture-cloud-gift-notification-modal__body">
                      <h2
                        id={headingId}
                        className="big-picture-cloud-gift-notification-modal__title"
                      >
                        {t("cloud_gift_received_title", {
                          count: gift.durationMonths,
                        })}
                      </h2>

                      {gift.message && (
                        <FocusItem
                          id={MESSAGE_FOCUS_ID}
                          focusable={isRevealComplete}
                          navigationOverrides={{
                            down: {
                              type: "item",
                              itemId: BUYER_PROFILE_FOCUS_ID,
                            },
                          }}
                          asChild
                        >
                          <div
                            ref={messageRef}
                            className="big-picture-cloud-gift-notification-modal__message-card"
                            data-suppress-navigation-autoscroll="true"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHtml(gift.message),
                            }}
                          />
                        </FocusItem>
                      )}

                      <Button
                        variant="link"
                        focusId={BUYER_PROFILE_FOCUS_ID}
                        focusable={isRevealComplete}
                        href={buyerProfilePath}
                        icon={
                          <UserProfileAvatar
                            image={gift.buyer.profileImageUrl}
                            alt={gift.buyer.displayName}
                            className="big-picture-cloud-gift-notification-modal__buyer-avatar"
                            fallbackClassName="big-picture-cloud-gift-notification-modal__buyer-avatar--fallback"
                            width={40}
                            height={40}
                            iconSize={24}
                          />
                        }
                        className="big-picture-cloud-gift-notification-modal__sender"
                        onClick={dismissCurrentGift}
                      >
                        {gift.buyer.displayName}
                      </Button>
                    </div>

                    <Button
                      focusId={ACCEPT_GIFT_FOCUS_ID}
                      focusable={isRevealComplete}
                      stealFocusOnAppear={isRevealComplete}
                      loading={isAccepting}
                      disabled={!isRevealComplete || isAccepting}
                      className="big-picture-cloud-gift-notification-modal__accept"
                      onClick={() => void acceptGift()}
                    >
                      {t("cloud_gift_launcher_accept")}
                    </Button>
                  </div>
                </motion.section>

                <motion.div
                  className="big-picture-cloud-gift-notification-modal__logo"
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
                >
                  <LogoFigma className="big-picture-cloud-gift-notification-modal__logo-art" />
                  {!shouldReduceMotion && (
                    <span className="big-picture-cloud-gift-notification-modal__logo-shine" />
                  )}
                </motion.div>

                <Button
                  variant="link"
                  focusId={DECIDE_LATER_FOCUS_ID}
                  focusable={isRevealComplete}
                  className="big-picture-cloud-gift-notification-modal__decide-later"
                  style={{ top: `calc(50% + ${331 + messageHeightExtra}px)` }}
                  onClick={dismissCurrentGift}
                >
                  {t("cloud_gift_launcher_decide_later")}
                </Button>
              </div>
            </VerticalFocusGroup>
          </NavigationLayer>
        </motion.div>
      )}
    </AnimatePresence>,
    portalTarget
  );
}
