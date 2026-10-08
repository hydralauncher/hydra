import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KebabHorizontalIcon,
  LinkExternalIcon,
  PersonIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { buildGameDetailsPath } from "@renderer/helpers";
import type { UserFriend } from "@types";

import { ChatFriendAvatar, ChatFriendStatus } from "./chat-friend-status";
import { useDismiss } from "./use-dismiss";

const electron = globalThis.electron as Electron;

export interface ChatConversationHeaderProps {
  friend: UserFriend;
  onClose: () => void;
}

export function ChatConversationHeader({
  friend,
  onClose,
}: ChatConversationHeaderProps) {
  const { t } = useTranslation("chat_window");

  const menuRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  useDismiss(menuRef, isMenuOpen, closeMenu);

  // Cloud members' profile banner sits behind the header.
  const { currentGame, backgroundImageUrl } = friend;
  const hasBanner = Boolean(backgroundImageUrl);
  const profileLabel = t("view_profile_of", { name: friend.displayName });

  const openProfile = () => electron.openFriendProfileInMainWindow(friend.id);

  return (
    <header
      className={cn("chat-window__conversation-header", {
        "chat-window__conversation-header--banner": hasBanner,
      })}
    >
      {hasBanner && (
        <div className="chat-window__header-banner" aria-hidden="true">
          <img src={backgroundImageUrl!} alt="" />
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
        <ChatFriendAvatar friend={friend} size={32} showCloudRing />
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

        {currentGame ? (
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
          <ChatFriendStatus friend={friend} />
        )}
      </div>

      <div className="chat-window__menu" ref={menuRef}>
        <button
          type="button"
          className={cn("chat-window__icon-button", {
            "chat-window__icon-button--active": isMenuOpen,
          })}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label={t("more_options")}
          title={t("more_options")}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <KebabHorizontalIcon size={16} className="chat-window__kebab-icon" />
        </button>

        {isMenuOpen && (
          <div
            className="chat-window__menu-popover"
            role="menu"
            aria-label={t("more_options")}
          >
            <button
              type="button"
              role="menuitem"
              className="chat-window__menu-item"
              onClick={() => {
                closeMenu();
                openProfile();
              }}
            >
              <PersonIcon size={16} />
              {t("view_profile")}
            </button>

            <div className="chat-window__menu-divider" role="separator" />

            <button
              type="button"
              role="menuitem"
              className="chat-window__menu-item"
              onClick={() => {
                closeMenu();
                onClose();
              }}
            >
              <XIcon size={16} />
              {t("close_conversation_menu")}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
