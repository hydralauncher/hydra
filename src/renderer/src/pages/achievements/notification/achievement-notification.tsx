import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  AchievementNotificationInfo,
  AchievementNotificationRequest,
} from "@types";
import {
  injectCustomCss,
  removeCustomCss,
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "@renderer/helpers";
import { AchievementNotificationItem } from "@renderer/components/achievements/notification/achievement-notification";
import { levelDBService } from "@renderer/services/leveldb.service";
import { logger } from "@renderer/logger";
import HydraIconUrl from "@renderer/assets/icons/hydra.svg?url";
import app from "../../../app.scss?inline";
import styles from "../../../components/achievements/notification/achievement-notification.scss?inline";
import root from "react-shadow";
import { armNotificationAnimations } from "./arm-notification-animations";
import { resolveImageUrl } from "./resolve-image-url";

const NOTIFICATION_TIMEOUT = 4_000;
const CLOSING_TIMEOUT = 450;
const ARMING_TIMEOUT = 1_000;

type NotificationPhase = "idle" | "arming" | "playing" | "closing";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
};

export function AchievementNotification() {
  const { t } = useTranslation("achievement");
  const [request, setRequest] = useState<AchievementNotificationRequest | null>(
    null
  );
  const [achievement, setAchievement] =
    useState<AchievementNotificationInfo | null>(null);
  const [phase, setPhase] = useState<NotificationPhase>("idle");
  const [shadowRootRef, setShadowRootRef] = useState<HTMLElement | null>(null);

  const requestRef = useRef<AchievementNotificationRequest | null>(null);
  const preparationSequence = useRef(0);
  const hostReadyReported = useRef(false);
  const displayTimer = useRef<number | null>(null);
  const closingTimer = useRef<number | null>(null);
  const playedSoundBatch = useRef<string | null>(null);
  const startVisibleRef = useRef(false);

  const clearAnimationTimers = useCallback(() => {
    if (displayTimer.current !== null) {
      window.clearTimeout(displayTimer.current);
      displayTimer.current = null;
    }
    if (closingTimer.current !== null) {
      window.clearTimeout(closingTimer.current);
      closingTimer.current = null;
    }
  }, []);

  const playAudio = useCallback(async () => {
    try {
      const [soundUrl, volume] = await Promise.all([
        getAchievementSoundUrl(),
        getAchievementSoundVolume(),
      ]);
      const audio = new Audio(soundUrl);
      audio.volume = volume;
      await audio.play();
      return true;
    } catch (error) {
      logger.error("Failed to play achievement notification sound", error);
      return false;
    }
  }, []);

  const loadAndApplyTheme = useCallback(async () => {
    if (!shadowRootRef) return;
    const allThemes = (await levelDBService.values("themes")) as {
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code, shadowRootRef);
    } else {
      removeCustomCss(shadowRootRef);
    }
  }, [shadowRootRef]);

  useEffect(() => {
    if (!shadowRootRef || hostReadyReported.current) return;

    let cancelled = false;
    void loadAndApplyTheme()
      .then(async () => {
        if (cancelled || hostReadyReported.current) return;
        hostReadyReported.current = true;
        await window.electron.achievementNotificationHostReady();
      })
      .catch((error) => {
        if (cancelled) return;
        void window.electron.achievementNotificationFailed(
          undefined,
          `Failed to initialise notification renderer: ${getErrorMessage(error)}`
        );
      });

    return () => {
      cancelled = true;
    };
  }, [loadAndApplyTheme, shadowRootRef]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      void loadAndApplyTheme().catch((error) => {
        void window.electron.achievementNotificationFailed(
          requestRef.current?.id,
          `Failed to update notification theme: ${getErrorMessage(error)}`
        );
      });
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  const reportContentReady = useCallback((requestId: string) => {
    void window.electron
      .achievementNotificationContentReady(requestId)
      .catch((error) => {
        void window.electron.achievementNotificationFailed(
          requestId,
          `Failed to report prepared notification: ${getErrorMessage(error)}`
        );
      });
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onPrepareAchievementNotification(
      (nextRequest) => {
        const sequence = preparationSequence.current + 1;
        preparationSequence.current = sequence;
        clearAnimationTimers();
        requestRef.current = null;
        setRequest(null);
        setAchievement(null);
        setPhase("idle");

        const resolveIcon = () => {
          if (nextRequest.type === "screenshot") return Promise.resolve("");
          if (nextRequest.type === "combined") {
            return Promise.resolve(HydraIconUrl);
          }
          return resolveImageUrl(nextRequest.achievement.iconUrl, HydraIconUrl);
        };

        void resolveIcon()
          .then((resolvedIcon) => {
            if (preparationSequence.current !== sequence) return;

            const nextAchievement: AchievementNotificationInfo =
              nextRequest.type === "combined"
                ? {
                    title: t("new_achievements"),
                    description: t("new_achievements_description", {
                      achievements: t("new_achievements_achievement_count", {
                        count: nextRequest.achievementCount,
                      }),
                      games: t("new_achievements_game_count", {
                        count: nextRequest.gameCount,
                      }),
                    }),
                    isHidden: false,
                    isRare: false,
                    isPlatinum: false,
                    iconUrl: resolvedIcon,
                  }
                : { ...nextRequest.achievement, iconUrl: resolvedIcon };

            requestRef.current = nextRequest;
            setRequest(nextRequest);
            setAchievement(nextAchievement);
            reportContentReady(nextRequest.id);
          })
          .catch((error) => {
            if (preparationSequence.current !== sequence) return;
            void window.electron.achievementNotificationFailed(
              nextRequest.id,
              `Failed to prepare notification content: ${getErrorMessage(error)}`
            );
          });
      }
    );

    return () => unsubscribe();
  }, [clearAnimationTimers, reportContentReady, t]);

  const finishNotification = useCallback((requestId: string) => {
    if (requestRef.current?.id !== requestId) return;

    preparationSequence.current += 1;
    requestRef.current = null;
    setRequest(null);
    setAchievement(null);
    setPhase("idle");
    void window.electron.achievementNotificationFinished(requestId);
  }, []);

  const scheduleClosing = useCallback(
    (requestId: string) => {
      closingTimer.current = window.setTimeout(() => {
        finishNotification(requestId);
      }, CLOSING_TIMEOUT);
    },
    [finishNotification]
  );

  const playAchievementSound = useCallback(
    async (requestId: string, batchId: string) => {
      playedSoundBatch.current = batchId;
      const played = await playAudio();
      if (!played) {
        if (playedSoundBatch.current === batchId) {
          playedSoundBatch.current = null;
        }
        return;
      }

      try {
        await window.electron.achievementNotificationSoundPlayed(
          requestId,
          batchId
        );
      } catch (error) {
        logger.error("Failed to report notification sound", error);
      }
    },
    [playAudio]
  );

  const beginPlayback = useCallback(() => {
    const activeRequest = requestRef.current;
    if (!activeRequest) return;

    const requestId = activeRequest.id;

    void window.electron
      .achievementNotificationStarted(requestId)
      .catch((error) => {
        logger.error("Failed to report notification start", error);
      });

    if (
      activeRequest.type !== "screenshot" &&
      playedSoundBatch.current !== activeRequest.batchId
    ) {
      void playAchievementSound(requestId, activeRequest.batchId);
    }

    displayTimer.current = window.setTimeout(() => {
      if (requestRef.current?.id !== requestId) return;
      setPhase("closing");
      scheduleClosing(requestId);
    }, NOTIFICATION_TIMEOUT);
  }, [playAchievementSound, scheduleClosing]);

  useEffect(() => {
    const unsubscribe = window.electron.onStartAchievementNotification(
      (requestId, visible) => {
        if (requestRef.current?.id !== requestId) return;

        clearAnimationTimers();

        startVisibleRef.current = visible;
        setPhase("arming");
      }
    );

    return () => unsubscribe();
  }, [clearAnimationTimers]);

  useLayoutEffect(() => {
    if (phase !== "arming") return;

    const card = shadowRootRef?.querySelector(".achievement-notification");

    return armNotificationAnimations({
      card: card ?? null,
      scheduler: {
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (handle) => window.cancelAnimationFrame(handle),
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: (handle) => window.clearTimeout(handle),
      },
      timeoutMs: ARMING_TIMEOUT,
      onArmed: () => {
        setPhase("playing");
        beginPlayback();
      },
      canPlayWithoutFrames: () => startVisibleRef.current,
      onTimeout: () => {
        const requestId = requestRef.current?.id;
        if (!requestId) return;

        void window.electron.achievementNotificationFailed(
          requestId,
          "notification window did not become visible"
        );
      },
    });
  }, [beginPlayback, phase, shadowRootRef]);

  useEffect(() => {
    return () => {
      preparationSequence.current += 1;
      clearAnimationTimers();
    };
  }, [clearAnimationTimers]);

  return (
    <root.div>
      <style type="text/css">
        {app} {styles}
      </style>
      <section ref={setShadowRootRef}>
        {request && achievement && phase !== "idle" && (
          <AchievementNotificationItem
            achievement={achievement}
            isClosing={phase === "closing"}
            position={request.position}
          />
        )}
      </section>
    </root.div>
  );
}
