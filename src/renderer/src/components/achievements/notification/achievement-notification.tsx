import { useLayoutEffect, useRef } from "react";
import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import cn from "classnames";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { EyeClosedIcon } from "@primer/octicons-react";
import Ellipses from "@renderer/assets/icons/ellipses.png";
import { getComputedAchievementNotificationLayout } from "@renderer/helpers";
import "./achievement-notification.scss";

interface AchievementNotificationProps {
  position: AchievementCustomNotificationPosition;
  achievement: AchievementNotificationInfo;
  isClosing: boolean;
  onLayout?: (layout: {
    position: AchievementCustomNotificationPosition;
    width: number;
    height: number;
  }) => void;
  layoutVersion?: number;
}

export function AchievementNotificationItem({
  position,
  achievement,
  isClosing,
  onLayout,
  layoutVersion,
}: Readonly<AchievementNotificationProps>) {
  const baseClassName = "achievement-notification";
  const notificationRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (notificationRef.current && onLayout) {
      onLayout(
        getComputedAchievementNotificationLayout(
          notificationRef.current,
          position
        )
      );
    }
  }, [achievement, layoutVersion, onLayout, position]);

  return (
    <div
      ref={notificationRef}
      className={cn("achievement-notification", {
        [`${baseClassName}--${position}`]: true,
        [`${baseClassName}--closing`]: isClosing,
        [`${baseClassName}--hidden`]: achievement.isHidden,
        [`${baseClassName}--rare`]: achievement.isRare,
        [`${baseClassName}--platinum`]: achievement.isPlatinum,
      })}
    >
      <div className="achievement-notification__scale-frame">
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
              <img
                src={achievement.iconUrl}
                alt={achievement.title}
                className="achievement-notification__icon"
              />
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
    </div>
  );
}
