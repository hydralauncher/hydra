import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import cn from "classnames";
import "./achievement-notification.scss";

interface AchievementNotificationProps {
  position: AchievementCustomNotificationPosition;
  currentAchievement: AchievementNotificationInfo;
  isClosing: boolean;
}

export function AchievementNotificationItem({
  position,
  currentAchievement,
  isClosing,
}: Readonly<AchievementNotificationProps>) {
  return (
    <div
      className={cn("achievement-notification", {
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
            src={currentAchievement.iconUrl}
            alt={currentAchievement.title}
            className="achievement-notification__icon"
          />
          <div className="achievement-notification__text-container">
            <p className="achievement-notification__title">
              {currentAchievement.title}
            </p>
            <p className="achievement-notification__description">
              {currentAchievement.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
