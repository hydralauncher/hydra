import {
  AchievementCustomNotificationPosition,
  FriendNotificationInfo,
} from "@types";
import cn from "classnames";
import "./friend-notification.scss";

interface FriendNotificationProps {
  position: AchievementCustomNotificationPosition;
  friend: FriendNotificationInfo;
  isClosing: boolean;
}

export function FriendNotificationItem({
  position,
  friend,
  isClosing,
}: Readonly<FriendNotificationProps>) {
  const baseClassName = "friend-notification";

  return (
    <div
      className={cn("friend-notification", {
        [`${baseClassName}--${position}`]: true,
        [`${baseClassName}--closing`]: isClosing,
      })}
    >
      <div className="friend-notification__outer-container">
        <div className="friend-notification__container">
          <div className="friend-notification__content">
            {friend.profileImageUrl ? (
              <img
                src={friend.profileImageUrl}
                alt={friend.displayName}
                className="friend-notification__avatar"
              />
            ) : (
              <div className="friend-notification__avatar-fallback">
                {friend.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="friend-notification__text-container">
              <p className="friend-notification__title">{friend.displayName}</p>
              <p className="friend-notification__description">
                {friend.gameIconUrl && (
                  <img
                    src={friend.gameIconUrl}
                    alt={friend.gameTitle}
                    className="friend-notification__game-icon"
                  />
                )}
                {friend.gameTitle}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
