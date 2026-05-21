import "./styles.scss";

import cn from "classnames";
import { CheckCircle, FolderOpen } from "@phosphor-icons/react";
import { formatBytes } from "@shared";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FocusItem } from "../focus-item";
import { Tooltip } from "../tooltip";
import type { FocusOverrides, NavigationNodeState } from "../../../services";
import type { FocusItemActions } from "../../../types";

export interface UserDiskItemProps {
  title: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
  isSelected?: boolean;
  showSelectedIndicator?: boolean;
  onClick?: () => void;
  focusId?: string;
  focusActions?: FocusItemActions;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationState?: NavigationNodeState;
  className?: string;
  topRightContent?: ReactNode;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function UserDiskItem({
  title,
  path,
  freeBytes,
  totalBytes,
  isSelected = false,
  showSelectedIndicator = false,
  onClick,
  focusId,
  focusActions,
  focusNavigationOverrides,
  focusNavigationState,
  className,
  topRightContent,
}: Readonly<UserDiskItemProps>) {
  const safeFreeBytes = Math.max(freeBytes, 0);
  const safeTotalBytes = Math.max(totalBytes, 0);
  const usedBytes = Math.max(safeTotalBytes - safeFreeBytes, 0);
  const usedRatio =
    safeTotalBytes > 0 ? clamp(usedBytes / safeTotalBytes, 0, 1) : 0;
  const pathRef = useRef<HTMLParagraphElement | null>(null);
  const [isPathTruncated, setIsPathTruncated] = useState(false);
  const rootClassName = cn("user-disk-item", className, {
    "user-disk-item--selected": isSelected,
    "user-disk-item--interactive": Boolean(onClick),
  });
  const shouldShowSelectedIndicator = showSelectedIndicator && isSelected;
  const shouldRenderTopRight =
    Boolean(topRightContent) || shouldShowSelectedIndicator;
  const shouldWrapWithFocusItem =
    onClick ||
    focusId !== undefined ||
    focusActions !== undefined ||
    focusNavigationOverrides !== undefined ||
    focusNavigationState !== undefined;
  const updatePathTruncation = useCallback(() => {
    const pathElement = pathRef.current;

    if (!(pathElement instanceof HTMLElement)) {
      setIsPathTruncated(false);
      return;
    }

    setIsPathTruncated(pathElement.scrollWidth > pathElement.clientWidth);
  }, []);

  useLayoutEffect(() => {
    updatePathTruncation();
  }, [path, updatePathTruncation]);

  useEffect(() => {
    const pathElement = pathRef.current;

    if (
      !(pathElement instanceof HTMLElement) ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updatePathTruncation();
    });

    resizeObserver.observe(pathElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [path, updatePathTruncation]);

  const content = (
    <>
      {shouldRenderTopRight && (
        <div className="user-disk-item__top-right">
          {topRightContent ? (
            <div className="user-disk-item__top-right-action">
              {topRightContent}
            </div>
          ) : null}

          {shouldShowSelectedIndicator ? (
            <CheckCircle
              size={18}
              weight="fill"
              aria-hidden="true"
              className="user-disk-item__selected-icon user-disk-item__selected-icon--visible"
            />
          ) : null}
        </div>
      )}

      <div className="user-disk-item__header">
        <div className="user-disk-item__title-row">
          <FolderOpen
            size={20}
            weight={isSelected ? "fill" : "duotone"}
            className="user-disk-item__icon"
          />
          <h3 className="user-disk-item__title">{title}</h3>
        </div>

        <div className="user-disk-item__path-wrapper">
          <Tooltip content={path} active={isPathTruncated}>
            <p ref={pathRef} className="user-disk-item__path">
              {path}
            </p>
          </Tooltip>
        </div>
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
        actions={focusActions}
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

  if (shouldWrapWithFocusItem) {
    return (
      <FocusItem
        id={focusId}
        actions={focusActions}
        navigationOverrides={focusNavigationOverrides}
        navigationState={focusNavigationState}
        asChild
      >
        <article className={rootClassName}>{content}</article>
      </FocusItem>
    );
  }

  return <article className={rootClassName}>{content}</article>;
}
