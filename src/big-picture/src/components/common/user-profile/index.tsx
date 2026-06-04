import "./styles.scss";

import {
  BellIcon,
  CheckIcon,
  CopyIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { type KeyboardEvent, type MouseEvent, type Ref, useState } from "react";
import { Link } from "react-router-dom";
import type { FocusOverrides } from "../../../services";
import { FocusItem } from "../focus-item";

export interface UserProfileProps {
  image: string;
  name: string;
  friendCode: string;
  profileFocusId?: string;
  friendsFocusId?: string;
  notificationsFocusId?: string;
  profileFocusNavigationOverrides?: FocusOverrides;
  friendsFocusNavigationOverrides?: FocusOverrides;
  notificationsFocusNavigationOverrides?: FocusOverrides;
  notificationCount?: number;
  notificationsButtonRef?: Ref<HTMLButtonElement>;
  onProfileClick?: () => void;
  onNotificationsClick?: () => void;
}

interface UserProfileContentProps {
  image: string;
  name: string;
  friendCode: string;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  onProfileClick?: () => void;
}

interface UserProfileActionsProps {
  friendsCount: number;
  friendsFocusId?: string;
  notificationsFocusId?: string;
  friendsFocusNavigationOverrides?: FocusOverrides;
  notificationsFocusNavigationOverrides?: FocusOverrides;
  notificationCount?: number;
  notificationsButtonRef?: Ref<HTMLButtonElement>;
  onNotificationsClick?: () => void;
}

function UserProfileActions({
  friendsCount,
  friendsFocusId,
  notificationsFocusId,
  friendsFocusNavigationOverrides,
  notificationsFocusNavigationOverrides,
  notificationCount = 0,
  notificationsButtonRef,
  onNotificationsClick,
}: Readonly<UserProfileActionsProps>) {
  const [isHovering, setIsHovering] = useState(false);

  const friendsLink = (
    <Link to="/friends" className="user-profile__actions__friends">
      <UsersIcon size={20} className="user-profile__actions__friends__icon" />

      <p className="user-profile__actions__friends__count">
        <span className="user-profile__actions__friends__count__number">
          {friendsCount}
        </span>{" "}
        <span className="user-profile__actions__friends__count__text">
          friends online
        </span>
      </p>
    </Link>
  );

  const notificationsButton = (
    <button
      type="button"
      ref={notificationsButtonRef}
      className="user-profile__actions__notification"
      onClick={onNotificationsClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      aria-label="Open notifications"
    >
      {notificationCount > 0 ? (
        <span className="user-profile__actions__notification-badge">
          {notificationCount > 99 ? "99+" : notificationCount}
        </span>
      ) : null}
      <BellIcon size={20} weight={isHovering ? "fill" : "regular"} />
    </button>
  );

  return (
    <div className="user-profile__actions">
      {friendsFocusId ? (
        <FocusItem
          id={friendsFocusId}
          navigationOverrides={friendsFocusNavigationOverrides}
          asChild
        >
          {friendsLink}
        </FocusItem>
      ) : (
        friendsLink
      )}

      {notificationsFocusId ? (
        <FocusItem
          id={notificationsFocusId}
          navigationOverrides={notificationsFocusNavigationOverrides}
          asChild
        >
          {notificationsButton}
        </FocusItem>
      ) : (
        notificationsButton
      )}
    </div>
  );
}

function UserProfileContent({
  image,
  name,
  friendCode,
  focusId,
  focusNavigationOverrides,
  onProfileClick,
}: Readonly<UserProfileContentProps>) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (isCopied) return;
    setIsCopied(true);
    globalThis.window.electron.clipboard.writeText(friendCode).catch(() => {});

    globalThis.window.setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  const handleProfileKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onProfileClick || event.currentTarget !== event.target) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    onProfileClick();
  };

  const content = (
    <div
      className="user-profile-content"
      role={onProfileClick ? "button" : undefined}
      tabIndex={onProfileClick && !focusId ? 0 : undefined}
      aria-label={onProfileClick ? `Open profile for ${name}` : undefined}
      onClick={onProfileClick}
      onKeyDown={handleProfileKeyDown}
    >
      <img
        src={image}
        alt={name}
        className="user-profile-content__image"
        width={48}
        height={48}
        draggable={false}
      />

      <div className="user-profile-content__info">
        <p className="user-profile-content__info__name">{name}</p>
        <button
          className="user-profile-content__info__friend-code"
          onClick={handleCopy}
        >
          {friendCode}
          {isCopied ? (
            <CheckIcon
              size={14}
              className="user-profile-content__info__friend-code__icon"
            />
          ) : (
            <CopyIcon
              size={14}
              className="user-profile-content__info__friend-code__icon"
            />
          )}
        </button>
      </div>
    </div>
  );

  if (!focusId) return content;

  return (
    <FocusItem
      id={focusId}
      actions={onProfileClick ? { primary: onProfileClick } : undefined}
      navigationOverrides={focusNavigationOverrides}
      asChild
    >
      {content}
    </FocusItem>
  );
}

export function UserProfile({
  image,
  name,
  friendCode,
  profileFocusId,
  friendsFocusId,
  notificationsFocusId,
  profileFocusNavigationOverrides,
  friendsFocusNavigationOverrides,
  notificationsFocusNavigationOverrides,
  notificationCount,
  notificationsButtonRef,
  onProfileClick,
  onNotificationsClick,
}: Readonly<UserProfileProps>) {
  return (
    <div className="user-profile-container">
      <UserProfileContent
        image={image}
        name={name}
        friendCode={friendCode}
        focusId={profileFocusId}
        focusNavigationOverrides={profileFocusNavigationOverrides}
        onProfileClick={onProfileClick}
      />
      <UserProfileActions
        friendsCount={8}
        friendsFocusId={friendsFocusId}
        notificationsFocusId={notificationsFocusId}
        friendsFocusNavigationOverrides={friendsFocusNavigationOverrides}
        notificationsFocusNavigationOverrides={
          notificationsFocusNavigationOverrides
        }
        notificationCount={notificationCount}
        notificationsButtonRef={notificationsButtonRef}
        onNotificationsClick={onNotificationsClick}
      />
    </div>
  );
}
