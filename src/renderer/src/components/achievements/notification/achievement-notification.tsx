import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import cn from "classnames";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import {
  AlertIcon,
  DeviceCameraIcon,
  EyeClosedIcon,
} from "@primer/octicons-react";
import Ellipses from "@renderer/assets/icons/ellipses.png";
import { useLayoutEffect, useRef } from "react";
import {
  pauseNotificationPseudoAnimations,
  restartNotificationAnimations,
  type NotificationAnimation,
} from "@renderer/helpers/notification-animations";
import "./achievement-notification.scss";

const SCREENSHOT_ICON_SIZE = 28;

interface AchievementNotificationProps {
  position: AchievementCustomNotificationPosition;
  achievement: AchievementNotificationInfo;
  isClosing: boolean;
}

export function AchievementNotificationItem({
  position,
  achievement,
  isClosing,
}: Readonly<AchievementNotificationProps>) {
  const baseClassName = "achievement-notification";
  const isScreenshotError = achievement.variant === "screenshot-error";
  const isScreenshot =
    achievement.variant === "screenshot" || isScreenshotError;
  const cardRef = useRef<HTMLDivElement>(null);
  const pausedAnimations = useRef<NotificationAnimation[]>([]);

  useLayoutEffect(() => {
    if (isClosing) {
      pausedAnimations.current = pauseNotificationPseudoAnimations(
        cardRef.current
      );
      return;
    }

    if (!pausedAnimations.current.length) return;

    const animations = pausedAnimations.current;
    pausedAnimations.current = [];
    restartNotificationAnimations(animations);
  }, [isClosing]);

  return (
    <div
      ref={cardRef}
      className={cn("achievement-notification", {
        [`${baseClassName}--${position}`]: true,
        [`${baseClassName}--closing`]: isClosing,
        [`${baseClassName}--hidden`]: achievement.isHidden,
        [`${baseClassName}--rare`]: achievement.isRare,
        [`${baseClassName}--platinum`]: achievement.isPlatinum,
        [`${baseClassName}--screenshot`]: isScreenshot,
        [`${baseClassName}--screenshot-error`]: isScreenshotError,
      })}
    >
      {achievement.points !== undefined && (
        <div className="achievement-notification__chip">
          <HydraIcon className="achievement-notification__chip__icon" />
          <span className="achievement-notification__chip__label">
            +{achievement.points}
          </span>
        </div>
      )}

      <div className="achievement-notification__outer-container">
        <div className="achievement-notification__container">
          <div className="achievement-notification__content">
            {isScreenshot ? (
              <span className="achievement-notification__icon" aria-hidden>
                {isScreenshotError ? (
                  <AlertIcon size={SCREENSHOT_ICON_SIZE} />
                ) : (
                  <DeviceCameraIcon size={SCREENSHOT_ICON_SIZE} />
                )}
              </span>
            ) : (
              <img
                src={achievement.iconUrl}
                alt={achievement.title}
                className="achievement-notification__icon"
              />
            )}
            <div className="achievement-notification__text-container">
              <p className="achievement-notification__title">
                {achievement.isHidden && (
                  <span className="achievement-notification__hidden-icon">
                    <EyeClosedIcon size={16} />
                  </span>
                )}
                {achievement.title}
              </p>
              <p className="achievement-notification__description">
                {achievement.description}
              </p>
            </div>
          </div>

          <div className="achievement-notification__additional-overlay">
            <div className="achievement-notification__dark-overlay"></div>
            <img
              className="achievement-notification__ellipses-overlay"
              src={Ellipses}
              alt=""
            />
            <div className="achievement-notification__trophy-overlay"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
