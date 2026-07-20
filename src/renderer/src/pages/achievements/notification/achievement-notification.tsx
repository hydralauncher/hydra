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
import HydraIconUrl from "@renderer/assets/icons/hydra.svg?url";
import app from "../../../app.scss?inline";
import styles from "../../../components/achievements/notification/achievement-notification.scss?inline";
import root from "react-shadow";

const NOTIFICATION_TIMEOUT = 4_000;
const CLOSING_TIMEOUT = 450;
const IMAGE_PREPARATION_TIMEOUT = 2_000;

type NotificationPhase = "idle" | "prepared" | "playing" | "closing";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const resolveImageUrl = (source: string): Promise<string> => {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;

    const finish = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(url);
    };

    const timeout = window.setTimeout(
      () => finish(HydraIconUrl),
      IMAGE_PREPARATION_TIMEOUT
    );

    image.onload = () => finish(source);
    image.onerror = () => finish(HydraIconUrl);
    image.src = source;
  });
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
    } catch (error) {
      console.error("Failed to play achievement notification sound", error);
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

        const sourceIcon =
          nextRequest.type === "achievement"
            ? nextRequest.achievement.iconUrl
            : HydraIconUrl;

        void resolveImageUrl(sourceIcon)
          .then((resolvedIcon) => {
            if (preparationSequence.current !== sequence) return;

            const nextAchievement: AchievementNotificationInfo =
              nextRequest.type === "achievement"
                ? { ...nextRequest.achievement, iconUrl: resolvedIcon }
                : {
                    title: t("new_achievements_unlocked", {
                      gameCount: nextRequest.gameCount,
                      achievementCount: nextRequest.achievementCount,
                    }),
                    isHidden: false,
                    isRare: false,
                    isPlatinum: false,
                    iconUrl: resolvedIcon,
                  };

            requestRef.current = nextRequest;
            setRequest(nextRequest);
            setAchievement(nextAchievement);
            setPhase("prepared");
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
  }, [clearAnimationTimers, t]);

  useLayoutEffect(() => {
    if (!request || !achievement || phase !== "prepared") return;

    let firstFrame = -1;
    let secondFrame = -1;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void window.electron
          .achievementNotificationContentReady(request.id)
          .catch((error) => {
            void window.electron.achievementNotificationFailed(
              request.id,
              `Failed to report prepared notification: ${getErrorMessage(error)}`
            );
          });
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [achievement, phase, request]);

  useEffect(() => {
    const unsubscribe = window.electron.onStartAchievementNotification(
      (requestId) => {
        if (requestRef.current?.id !== requestId) return;

        setPhase("playing");
        void playAudio();
        clearAnimationTimers();

        displayTimer.current = window.setTimeout(() => {
          if (requestRef.current?.id !== requestId) return;
          setPhase("closing");

          closingTimer.current = window.setTimeout(() => {
            if (requestRef.current?.id !== requestId) return;

            preparationSequence.current += 1;
            requestRef.current = null;
            setRequest(null);
            setAchievement(null);
            setPhase("idle");
            void window.electron.achievementNotificationFinished(requestId);
          }, CLOSING_TIMEOUT);
        }, NOTIFICATION_TIMEOUT);
      }
    );

    return () => unsubscribe();
  }, [clearAnimationTimers, playAudio]);

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
            isPaused={phase === "prepared"}
            position={request.position}
          />
        )}
      </section>
    </root.div>
  );
}
