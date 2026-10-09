import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Avatar } from "@renderer/components";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import type { UserFriend } from "@types";

export interface ChatFriendStatusProps {
  friend: UserFriend;
  isTyping?: boolean;
}

export function ChatFriendStatus({ friend, isTyping }: ChatFriendStatusProps) {
  const { t } = useTranslation("chat_window");

  if (isTyping) {
    return (
      <span className="chat-window__friend-status chat-window__friend-status--highlight">
        <ChatTypingDots size="small" />
        <span className="chat-window__friend-status-text">
          {t("typing_short")}
        </span>
      </span>
    );
  }

  if (friend.currentGame) {
    return (
      <span className="chat-window__friend-status chat-window__friend-status--highlight">
        {friend.currentGame.iconUrl ? (
          <img
            className="chat-window__game-icon"
            alt=""
            width={14}
            height={14}
            src={friend.currentGame.iconUrl}
          />
        ) : (
          <SteamLogo width={14} height={14} />
        )}
        <span className="chat-window__friend-status-text">
          {t("playing", { game: friend.currentGame.title })}
        </span>
      </span>
    );
  }

  return (
    <span className="chat-window__friend-status">
      {friend.isOnline ? t("online") : t("offline")}
    </span>
  );
}

export interface ChatFriendAvatarProps {
  friend: UserFriend;
  size: number;
}

export function ChatFriendAvatar({ friend, size }: ChatFriendAvatarProps) {
  return (
    <div className="chat-window__avatar-wrapper">
      <Avatar
        size={size}
        src={friend.profileImageUrl}
        alt={friend.displayName}
      />
      <span
        className={cn("chat-window__status-orb", {
          "chat-window__status-orb--online": friend.isOnline,
        })}
      />
    </div>
  );
}

export interface ChatTypingDotsProps {
  size?: "small" | "regular";
}

export function ChatTypingDots({ size = "regular" }: ChatTypingDotsProps) {
  return (
    <span
      className={cn("chat-window__typing-dots", {
        "chat-window__typing-dots--small": size === "small",
      })}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </span>
  );
}
