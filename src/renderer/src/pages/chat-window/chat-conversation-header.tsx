import { useTranslation } from "react-i18next";
import { LinkExternalIcon } from "@primer/octicons-react";
import cn from "classnames";

import { buildGameDetailsPath } from "@renderer/helpers";
import type { UserFriend } from "@types";

import { ChatFriendAvatar, ChatFriendStatus } from "./chat-friend-status";

const electron = globalThis.electron as Electron;

export interface ChatConversationHeaderProps {
  friend: UserFriend;
  isTyping: boolean;
}

/**
 * The active conversation's friend, under the tab strip. It keeps one height
 * with or without a banner, so switching tabs never moves the messages.
 */
export function ChatConversationHeader({
  friend,
  isTyping,
}: Readonly<ChatConversationHeaderProps>) {
  const { t } = useTranslation("chat_window");

  // Cloud members' profile banner sits behind the header.
  const { currentGame, backgroundImageUrl } = friend;
  const profileLabel = t("view_profile_of", { name: friend.displayName });

  const openProfile = () => electron.openFriendProfileInMainWindow(friend.id);

  return (
    <header
      className={cn("chat-window__conversation-header", {
        "chat-window__conversation-header--banner": backgroundImageUrl,
      })}
    >
      {backgroundImageUrl && (
        <div className="chat-window__header-banner" aria-hidden="true">
          <img src={backgroundImageUrl} alt="" />
        </div>
      )}

      {/* Duplicate of the name target, so it stays out of the tab order. */}
      <button
        type="button"
        className="chat-window__profile-link chat-window__profile-link--avatar"
        onClick={openProfile}
        title={t("view_profile")}
        aria-label={profileLabel}
        tabIndex={-1}
      >
        <ChatFriendAvatar friend={friend} size={32} />
      </button>

      <div className="chat-window__conversation-details">
        <button
          type="button"
          className="chat-window__profile-link chat-window__conversation-name"
          onClick={openProfile}
          title={t("view_profile")}
          aria-label={profileLabel}
        >
          {friend.displayName}
        </button>

        {currentGame && !isTyping ? (
          <button
            type="button"
            className="chat-window__game-link"
            onClick={() =>
              electron.openGameInMainWindow(buildGameDetailsPath(currentGame))
            }
            title={t("open_game", { game: currentGame.title })}
          >
            <ChatFriendStatus friend={friend} />
            <LinkExternalIcon
              size={12}
              className="chat-window__game-link-icon"
            />
          </button>
        ) : (
          <ChatFriendStatus friend={friend} isTyping={isTyping} />
        )}
      </div>
    </header>
  );
}
