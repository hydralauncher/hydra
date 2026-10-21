import cn from "classnames";

import { Avatar } from "../avatar/avatar";
import type { ScreenshotAuthor } from "@types";

import "./screenshot-owner-badge.scss";

interface ScreenshotOwnerBadgeProps {
  owner: ScreenshotAuthor;
  className?: string;
}

export function ScreenshotOwnerBadge({
  owner,
  className,
}: Readonly<ScreenshotOwnerBadgeProps>) {
  return (
    <span
      className={cn("screenshot-owner-badge", className)}
      title={owner.displayName}
    >
      <Avatar size={16} src={owner.profileImageUrl} alt="" />
      <span className="screenshot-owner-badge__name">{owner.displayName}</span>
    </span>
  );
}
