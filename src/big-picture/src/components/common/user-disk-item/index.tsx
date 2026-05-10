import "./styles.scss";

import cn from "classnames";
import { CheckCircle, FolderOpen } from "@phosphor-icons/react";
import { formatBytes } from "@shared";
import { FocusItem } from "../focus-item";
import type { FocusOverrides, NavigationNodeState } from "../../../services";

export interface UserDiskItemProps {
  title: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
  isSelected?: boolean;
  onClick?: () => void;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationState?: NavigationNodeState;
  className?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function UserDiskItem({
  title,
  path,
  freeBytes,
  totalBytes,
  isSelected = false,
  onClick,
  focusId,
  focusNavigationOverrides,
  focusNavigationState,
  className,
}: Readonly<UserDiskItemProps>) {
  const safeFreeBytes = Math.max(freeBytes, 0);
  const safeTotalBytes = Math.max(totalBytes, 0);
  const usedBytes = Math.max(safeTotalBytes - safeFreeBytes, 0);
  const usedRatio =
    safeTotalBytes > 0 ? clamp(usedBytes / safeTotalBytes, 0, 1) : 0;
  const rootClassName = cn("user-disk-item", className, {
    "user-disk-item--selected": isSelected,
    "user-disk-item--interactive": Boolean(onClick),
  });
  const content = (
    <>
      <CheckCircle
        size={18}
        weight="fill"
        aria-hidden="true"
        className={cn("user-disk-item__selected-icon", {
          "user-disk-item__selected-icon--visible": isSelected,
        })}
      />

      <div className="user-disk-item__header">
        <div className="user-disk-item__title-row">
          <FolderOpen
            size={20}
            weight="duotone"
            className="user-disk-item__icon"
          />
          <h3 className="user-disk-item__title">{title}</h3>
        </div>

        <p className="user-disk-item__path">{path}</p>
      </div>

      <div className="user-disk-item__usage">
        <div className="user-disk-item__track" aria-hidden="true">
          <div
            className="user-disk-item__fill"
            style={{ width: `${usedRatio * 100}%` }}
          />
        </div>

        <div className="user-disk-item__metrics">
          <p className="user-disk-item__metric">
            <span>{formatBytes(safeFreeBytes)}</span>
            <span>Free</span>
          </p>

          <p className="user-disk-item__metric user-disk-item__metric--secondary">
            <span>{formatBytes(safeTotalBytes)}</span>
            <span>Total</span>
          </p>
        </div>
      </div>
    </>
  );

  if (onClick) {
    return (
      <FocusItem
        id={focusId}
        navigationOverrides={focusNavigationOverrides}
        navigationState={focusNavigationState}
        asChild
      >
        <button
          type="button"
          className={rootClassName}
          onClick={onClick}
          aria-pressed={isSelected}
        >
          {content}
        </button>
      </FocusItem>
    );
  }

  return <article className={rootClassName}>{content}</article>;
}
