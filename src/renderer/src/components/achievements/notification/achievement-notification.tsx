import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import cn from "classnames";
import "./achievement-notification.scss";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";

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
  return (
    <div
      className={cn("achievement-notification", {
        [position]: true,
        closing: isClosing,
      })}
    >
      {achievement.points && (
        <div
          className={cn("achievement-notification__chip-container", {
            [position]: true,
            closing: isClosing,
          })}
        >
          <div className="achievement-notification__chip">
            <HydraIcon className="achievement-notification__chip__icon" />
            <span className="achievement-notification__chip__label">
              +{achievement.points}
            </span>
          </div>
        </div>
      )}

      <div
        className={cn("achievement-notification__outer-container", {
          [position]: true,
          closing: isClosing,
        })}
      >
        <div
          className={cn("achievement-notification__container", {
            [position]: true,
            closing: isClosing,
          })}
        >
          <div className="achievement-notification__content">
            <img
              src={achievement.iconUrl}
              alt={achievement.title}
              className="achievement-notification__icon"
            />
            <div className="achievement-notification__text-container">
              <p className="achievement-notification__title">
                {achievement.title}
              </p>
              <p className="achievement-notification__description">
                {achievement.description}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
