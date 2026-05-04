import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  FriendNotificationInfo,
} from "@types";
import {
  injectCustomCss,
  removeCustomCss,
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "@renderer/helpers";
import { AchievementNotificationItem } from "@renderer/components/achievements/notification/achievement-notification";
import { FriendNotificationItem } from "@renderer/components/friend-notification/friend-notification";
import { levelDBService } from "@renderer/services/leveldb.service";
import app from "../../../app.scss?inline";
import achievementStyles from "../../../components/achievements/notification/achievement-notification.scss?inline";
import friendStyles from "../../../components/friend-notification/friend-notification.scss?inline";
import root from "react-shadow";

const NOTIFICATION_TIMEOUT = 4000;

type NotificationQueueItem =
  | { type: "achievement"; data: AchievementNotificationInfo }
  | { type: "friend"; data: FriendNotificationInfo };

export function AchievementNotification() {
  const { t } = useTranslation("achievement");

  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] =
    useState<AchievementCustomNotificationPosition>("top-left");

  const [queue, setQueue] = useState<NotificationQueueItem[]>([]);
  const [currentItem, setCurrentItem] = useState<NotificationQueueItem | null>(
    null
  );

  const achievementAnimation = useRef(-1);
  const closingAnimation = useRef(-1);
  const visibleAnimation = useRef(-1);

  const [shadowRootRef, setShadowRootRef] = useState<HTMLElement | null>(null);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    audio.play();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onCombinedAchievementsUnlocked(
      (gameCount, achievementCount, position) => {
        if (gameCount === 0 || achievementCount === 0) return;

        setPosition(position);

        setQueue((prev) => [
          ...prev,
          {
            type: "achievement",
            data: {
              title: t("new_achievements_unlocked", {
                gameCount,
                achievementCount,
              }),
              isHidden: false,
              isRare: false,
              isPlatinum: false,
              iconUrl: "https://cdn.losbroxas.org/favicon.svg",
            },
          },
        ]);

        playAudio();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [t, playAudio]);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(
      (position, achievements) => {
        if (!achievements?.length) return;
        if (position) {
          setPosition(position);
        }

        setQueue((prev) => [
          ...prev,
          ...achievements.map(
            (a) => ({ type: "achievement", data: a }) as NotificationQueueItem
          ),
        ]);

        playAudio();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [playAudio]);

  useEffect(() => {
    const unsubscribe = window.electron.onFriendStartedPlaying(
      (position, friendInfo) => {
        if (!friendInfo) return;
        if (position) {
          setPosition(position);
        }

        setQueue((prev) => [...prev, { type: "friend", data: friendInfo }]);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const hasItemsPending = queue.length > 0;

  const startAnimateClosing = useCallback(() => {
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(visibleAnimation.current);
    cancelAnimationFrame(achievementAnimation.current);

    setIsClosing(true);

    const zero = performance.now();
    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 450) {
          closingAnimation.current = requestAnimationFrame(animateClosing);
        } else {
          setIsVisible(false);
          setQueue((q) => q.slice(1));
        }
      }
    );
  }, []);

  useEffect(() => {
    if (hasItemsPending) {
      setIsClosing(false);
      setIsVisible(true);

      let zero = performance.now();
      cancelAnimationFrame(closingAnimation.current);
      cancelAnimationFrame(visibleAnimation.current);
      cancelAnimationFrame(achievementAnimation.current);
      achievementAnimation.current = requestAnimationFrame(
        function animateLock(time) {
          if (time - zero > NOTIFICATION_TIMEOUT) {
            zero = performance.now();
            startAnimateClosing();
          }
          achievementAnimation.current = requestAnimationFrame(animateLock);
        }
      );
    }
  }, [hasItemsPending, startAnimateClosing, currentItem]);

  useEffect(() => {
    if (queue.length) {
      setCurrentItem(queue[0]);
    }
  }, [queue]);

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
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  return (
    <root.div>
      <style type="text/css">
        {app} {achievementStyles} {friendStyles}
      </style>
      <section ref={setShadowRootRef}>
        {isVisible && currentItem && (
          <>
            {currentItem.type === "achievement" && (
              <AchievementNotificationItem
                achievement={currentItem.data}
                isClosing={isClosing}
                position={position}
              />
            )}
            {currentItem.type === "friend" && (
              <FriendNotificationItem
                friend={currentItem.data}
                isClosing={isClosing}
                position={position}
              />
            )}
          </>
        )}
      </section>
    </root.div>
  );
}
