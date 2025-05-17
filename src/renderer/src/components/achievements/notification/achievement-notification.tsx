import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import cn from "classnames";
import "./achievement-notification.scss";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { EyeClosedIcon } from "@primer/octicons-react";
import Ellipses from "@renderer/assets/icons/ellipses.png";

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

  return (
    <div
      className={cn("achievement-notification", {
        [`${baseClassName}--${position}`]: true,
        [`${baseClassName}--closing`]: isClosing,
        [`${baseClassName}--hidden`]: achievement.isHidden,
        [`${baseClassName}--rare`]: achievement.isRare,
        [`${baseClassName}--platinum`]: achievement.isPlatinum,
      })}
    >
      {achievement.points && (
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
              alt="Ellipses effect"
            />
            <div className="achievement-notification__trophy-overlay"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
