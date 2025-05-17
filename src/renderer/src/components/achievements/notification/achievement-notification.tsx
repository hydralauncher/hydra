import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import cn from "classnames";
import "./achievement-notification.scss";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { EyeClosedIcon } from "@primer/octicons-react";

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
        isHidden: achievement.isHidden,
        isRare: achievement.isRare,
        isPlatinum: achievement.isPlatinum,
      })}
    >
      {achievement.points && (
        <div
          className={cn("achievement-notification__chip", {
            [position]: true,
          })}
        >
          <HydraIcon className="achievement-notification__chip__icon" />
          <span className="achievement-notification__chip__label">
            +{achievement.points}
          </span>
        </div>
      )}

      <div
        className={cn("achievement-notification__outer-container", {
          [position]: true,
        })}
      >
        <div
          className={cn("achievement-notification__container", {
            [position]: true,
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
            <div className="achievement-notification__additional-overlay__dark"></div>
            <img
              className="achievement-notification__additional-overlay__ellipses"
              src="/src/assets/icons/ellipses.png"
              alt="Ellipses effect"
            />
            <img
              className="achievement-notification__additional-overlay__trophy"
              src="/src/assets/icons/trophy.png"
              alt="Trophy effect"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
