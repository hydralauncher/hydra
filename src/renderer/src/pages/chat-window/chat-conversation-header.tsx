import { useTranslation } from "react-i18next";
import { DashIcon, LinkExternalIcon, XIcon } from "@primer/octicons-react";
import cn from "classnames";

import { buildGameDetailsPath } from "@renderer/helpers";
import type { UserFriend } from "@types";

import { ChatFriendAvatar, ChatFriendStatus } from "./chat-friend-status";
import { ChatOfficialBadge } from "./chat-official-badge";
import { isOfficialAccount } from "./chat-sidebar-layout";

const electron = globalThis.electron as Electron;

export interface ChatConversationHeaderProps {
  /** Null before the first conversation opens: only the window controls show. */
  friend: UserFriend | null;
  isTyping: boolean;
  onMinimize: () => void;
  onCloseWindow: () => void;
}

/**
 * The active conversation's friend, at the top of the chat pane, doubling as
 * the (frameless) window's title bar with its controls. It keeps one height
 * with or without a banner, so switching conversations never moves the
 * messages.
 */
export function ChatConversationHeader({
  friend,
  isTyping,
  onMinimize,
  onCloseWindow,
}: Readonly<ChatConversationHeaderProps>) {
  const { t } = useTranslation("chat_window");

  // Cloud members' profile banner sits behind the header.
  const backgroundImageUrl = friend?.backgroundImageUrl;
  const currentGame = friend?.currentGame;

  const openProfile = () => {
    if (friend) void electron.openFriendProfileInMainWindow(friend.id);
  };

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

      {friend && isOfficialAccount(friend) && (
        <>
          {/* No profile to open: the avatar and name are plain. */}
          <ChatFriendAvatar friend={friend} size={32} />

          <div className="chat-window__conversation-details">
            <span className="chat-window__conversation-title">
              <span className="chat-window__conversation-name">
                {friend.displayName}
              </span>
              <ChatOfficialBadge size={16} />
            </span>
            <span className="chat-window__friend-status">
              {t("official_subtitle")}
            </span>
          </div>
        </>
      )}

      {friend && !isOfficialAccount(friend) && (
        <>
          {/* Duplicate of the name target, so it stays out of the tab order. */}
          <button
            type="button"
            className="chat-window__profile-link chat-window__profile-link--avatar"
            onClick={openProfile}
            title={t("view_profile")}
            aria-label={t("view_profile_of", { name: friend.displayName })}
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
              aria-label={t("view_profile_of", { name: friend.displayName })}
            >
              {friend.displayName}
            </button>

            {currentGame && !isTyping ? (
              <button
                type="button"
                className="chat-window__game-link"
                onClick={() =>
                  electron.openGameInMainWindow(
                    buildGameDetailsPath(currentGame)
                  )
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
        </>
      )}

      {!electron.hasNativeWindowDecorations && (
        <div className="chat-window__window-controls">
          <button
            type="button"
            className="chat-window__window-control"
            onClick={onMinimize}
            title={t("minimize")}
            aria-label={t("minimize")}
          >
            <DashIcon size={16} />
          </button>
          <button
            type="button"
            className="chat-window__window-control chat-window__window-control--close"
            onClick={onCloseWindow}
            title={t("close_window")}
            aria-label={t("close_window")}
          >
            <XIcon size={16} />
          </button>
        </div>
      )}
    </header>
  );
}
