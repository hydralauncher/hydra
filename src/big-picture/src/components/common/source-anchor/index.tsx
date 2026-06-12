import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import cn from "classnames";
import { FocusItem } from "..";
import type { FocusOverrides } from "../../../services";

import "./styles.scss";

const sizes = {
  small: "source-anchor--small",
  medium: "source-anchor--medium",
  large: "source-anchor--large",
};

export interface SourceAnchorProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  title: string;
  size?: keyof typeof sizes;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  href?: string;
  onClick?: () => void;
  isSelected?: boolean;
}

export function SourceAnchor({
  title,
  focusId,
  focusNavigationOverrides,
  href,
  onClick,
  isSelected = false,
  size = "medium",
  ...props
}: Readonly<SourceAnchorProps>) {
  return (
    <>
      {href && (
        <FocusItem id={focusId} navigationOverrides={focusNavigationOverrides}>
          <a href={href} {...props}>
            <div
              className={cn("source-anchor source-anchor--link", sizes[size], {
                "source-anchor--selected": isSelected,
              })}
            >
              <p className="source-anchor__title">{title}</p>
            </div>
          </a>
        </FocusItem>
      )}

      {onClick && (
        <FocusItem id={focusId} navigationOverrides={focusNavigationOverrides}>
          <button
            type="button"
            onClick={onClick}
            aria-pressed={isSelected}
            {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
          >
            <div
              className={cn("source-anchor source-anchor--link", sizes[size], {
                "source-anchor--selected": isSelected,
              })}
            >
              <p className="source-anchor__title">{title}</p>
            </div>
          </button>
        </FocusItem>
      )}

      {!onClick && !href && (
        <div
          className={cn("source-anchor", sizes[size], {
            "source-anchor--selected": isSelected,
          })}
        >
          <p className="source-anchor__title">{title}</p>
        </div>
      )}
    </>
  );
}
