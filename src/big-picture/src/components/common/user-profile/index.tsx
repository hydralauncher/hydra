import {
  BellIcon,
  CheckIcon,
  CopyIcon,
  UsersIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Link } from "@renderer/components";
import { useState } from "react";
import "./style.scss";

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
    <div className="bp-user-profile__actions">
      <Link to="/friends" className="bp-user-profile__actions__friends">
        <UsersIcon
          size={20}
          className="bp-user-profile__actions__friends__icon"
        />

        <p className="bp-user-profile__actions__friends__count">
          <span className="bp-user-profile__actions__friends__count__number">
            {friendsCount}
          </span>{" "}
          <span className="bp-user-profile__actions__friends__count__text">
            friends online
          </span>
        </p>
      </Link>

      <button
        className="bp-user-profile__actions__notification"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <BellIcon size={20} weight={isHovering ? "fill" : "regular"} />
      </button>
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
    navigator.clipboard.writeText(friendCode);

    setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  return (
    <div className="bp-user-profile-content">
      {image ? (
        <img
          src={image}
          alt={name}
          className="bp-user-profile-content__image"
          width={48}
          height={48}
        />
      ) : (
        <UserIcon
          className="bp-user-profile-content__image"
          width={48}
          height={48}
        />
      )}

      <div className="bp-user-profile-content__info">
        <p className="bp-user-profile-content__info__name">{name}</p>
        <button
          className="bp-user-profile-content__info__friend-code"
          onClick={handleCopy}
        >
          {friendCode}
          {isCopied ? (
            <CheckIcon
              size={14}
              className="bp-user-profile-content__info__friend-code__icon"
            />
          ) : (
            <CopyIcon
              size={14}
              className="bp-user-profile-content__info__friend-code__icon"
            />
          )}
        </button>
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
    <div className="bp-user-profile-container">
      <UserProfileContent image={image} name={name} friendCode={friendCode} />
      <UserProfileActions friendsCount={8} />
    </div>
  );
}
