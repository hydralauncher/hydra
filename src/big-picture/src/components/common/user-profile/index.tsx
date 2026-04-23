import "./styles.scss";

import {
  BellIcon,
  CheckIcon,
  CopyIcon,
  UsersIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Link } from "@renderer/components";
import { useState } from "react";
import { FocusItem } from "../focus-item";
import { HorizontalFocusGroup } from "..";

export interface UserProfileProps {
  image?: string | null;
  name: string;
  friendCode: string;
}

interface UserProfileContentProps {
  image?: string | null;
  name: string;
  friendCode: string;
}

interface UserProfileActionsProps {
  friendsCount: number;
}

function UserProfileActions({
  friendsCount,
}: Readonly<UserProfileActionsProps>) {
  const [isHovering, setIsHovering] = useState(false);

  return (
    <div className="user-profile__actions">
      <HorizontalFocusGroup>
        <FocusItem>
          <Link to="/friends" className="user-profile__actions__friends">
            <UsersIcon
              size={20}
              className="user-profile__actions__friends__icon"
            />

            <p className="user-profile__actions__friends__count">
              <span className="user-profile__actions__friends__count__number">
                {friendsCount}
              </span>{" "}
              <span className="user-profile__actions__friends__count__text">
                friends online
              </span>
            </p>
          </Link>
        </FocusItem>

        <FocusItem>
          <button
            className="user-profile__actions__notification"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <BellIcon size={20} weight={isHovering ? "fill" : "regular"} />
          </button>
        </FocusItem>
      </HorizontalFocusGroup>
    </div>
  );
}

function UserProfileContent({
  image,
  name,
  friendCode,
}: Readonly<UserProfileContentProps>) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    if (isCopied) return;
    setIsCopied(true);
    navigator.clipboard.writeText(friendCode).catch(() => {});

    globalThis.window.setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  return (
    <div className="user-profile-content">
      {image ? (
        <img
          src={image}
          alt={name}
          className="user-profile-content__image"
          width={48}
          height={48}
        />
      ) : (
        <UserIcon
          className="user-profile-content__image"
          width={48}
          height={48}
        />
      )}

      <div className="user-profile-content__info">
        <p className="user-profile-content__info__name">{name}</p>
        <FocusItem>
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
        </FocusItem>
      </div>
    </div>
  );
}

export function UserProfile({
  image,
  name,
  friendCode,
}: Readonly<UserProfileProps>) {
  return (
    <div className="user-profile-container">
      <UserProfileContent image={image} name={name} friendCode={friendCode} />
      <UserProfileActions friendsCount={8} />
    </div>
  );
}
