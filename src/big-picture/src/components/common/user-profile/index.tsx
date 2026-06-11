import "./styles.scss";

import { BellIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, type MouseEvent, type Ref, useState } from "react";
import type { FocusOverrides } from "../../../services";
import { FocusItem } from "../focus-item";

export interface UserProfileProps {
  image: string;
  name: string;
  friendCode: string;
  profileFocusId?: string;
  notificationsFocusId?: string;
  profileFocusNavigationOverrides?: FocusOverrides;
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
  notificationCount?: number;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  onProfileClick?: () => void;
}

interface UserProfileNotificationProps {
  notificationsFocusId?: string;
  notificationsFocusNavigationOverrides?: FocusOverrides;
  notificationCount?: number;
  notificationsButtonRef?: Ref<HTMLButtonElement>;
  onNotificationsClick?: () => void;
}

function UserProfileNotification({
  notificationsFocusId,
  notificationsFocusNavigationOverrides,
  notificationCount = 0,
  notificationsButtonRef,
  onNotificationsClick,
}: Readonly<UserProfileNotificationProps>) {
  const [isHovering, setIsHovering] = useState(false);

  const notificationsButton = (
    <button
      type="button"
      ref={notificationsButtonRef}
      className="user-profile__notification"
      onClick={onNotificationsClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      aria-label="Open notifications"
    >
      {notificationCount > 0 ? (
        <span className="user-profile__notification-badge">
          {notificationCount > 99 ? "99+" : notificationCount}
        </span>
      ) : null}
      <BellIcon size={20} weight={isHovering ? "fill" : "regular"} />
    </button>
  );

  if (!notificationsFocusId) return notificationsButton;

  return (
    <FocusItem
      id={notificationsFocusId}
      navigationOverrides={notificationsFocusNavigationOverrides}
      asChild
    >
      {notificationsButton}
    </FocusItem>
  );
}

function UserProfileContent({
  image,
  name,
  friendCode,
  notificationCount = 0,
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
      <div className="user-profile-content__image-container">
        <img
          src={image}
          alt={name}
          className="user-profile-content__image"
          width={48}
          height={48}
          draggable={false}
        />

        {notificationCount > 0 ? (
          <span className="user-profile-content__notification-badge">
            {notificationCount > 99 ? "99+" : notificationCount}
          </span>
        ) : null}
      </div>

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
  notificationsFocusId,
  profileFocusNavigationOverrides,
  notificationsFocusNavigationOverrides,
  notificationCount,
  notificationsButtonRef,
  onProfileClick,
  onNotificationsClick,
}: Readonly<UserProfileProps>) {
  return (
    <div className="user-profile-container">
      <div className="user-profile-header">
        <UserProfileContent
          image={image}
          name={name}
          friendCode={friendCode}
          notificationCount={notificationCount}
          focusId={profileFocusId}
          focusNavigationOverrides={profileFocusNavigationOverrides}
          onProfileClick={onProfileClick}
        />
        <UserProfileNotification
          notificationsFocusId={notificationsFocusId}
          notificationsFocusNavigationOverrides={
            notificationsFocusNavigationOverrides
          }
          notificationCount={notificationCount}
          notificationsButtonRef={notificationsButtonRef}
          onNotificationsClick={onNotificationsClick}
        />
      </div>
    </div>
  );
}
