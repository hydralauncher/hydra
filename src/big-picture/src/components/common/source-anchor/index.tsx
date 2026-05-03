import type { AnchorHTMLAttributes } from "react";
import cn from "classnames";
import { FocusItem } from "..";

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
  href?: string;
  onClick?: () => void;
  isSelected?: boolean;
}

export function SourceAnchor({
  title,
  href,
  onClick,
  isSelected = false,
  size = "medium",
  ...props
}: Readonly<SourceAnchorProps>) {
  return (
    <>
      {href && (
        <FocusItem>
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
        <FocusItem>
          <button type="button" onClick={onClick} aria-pressed={isSelected}>
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
          className={cn("source-anchor source-anchor--link", sizes[size], {
            "source-anchor--selected": isSelected,
          })}
        >
          <p className="source-anchor__title">{title}</p>
        </div>
      )}
    </>
  );
}
