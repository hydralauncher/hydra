import "./styles.scss";

import { HeartStraightIcon } from "@phosphor-icons/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { FocusItem } from "..";

export interface RouteAnchorProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  label: string;
  icon: ReactNode | string;
  href: string;
  active?: boolean;
  disabled?: boolean;
  isFavorite?: boolean;
}

export const RouteAnchor = ({
  href,
  label,
  icon,
  active = false,
  disabled = false,
  isFavorite = false,
  ...props
}: Readonly<RouteAnchorProps>) => {
  const isGameIcon = typeof icon === "string";

  return (
    <div
      className={`state-wrapper ${disabled ? "state-wrapper--disabled" : ""} ${active ? "state-wrapper--active" : ""}`}
    >
      <FocusItem>
        <Link to={href} {...props}>
          <div
            className={`route-anchor ${active ? "route-anchor--active" : ""} ${!isGameIcon ? "route-anchor--extra-padding" : ""}`}
          >
            <div
              className={`route-anchor__icon ${isGameIcon ? "route-anchor__icon--large-size" : "route-anchor__icon--small-size"}`}
            >
              {isGameIcon ? (
                <img
                  src={icon}
                  alt={label}
                  width={32}
                  height={32}
                  draggable={false}
                />
              ) : (
                icon
              )}
            </div>
            <div className="route-anchor__label">{label}</div>

            {isFavorite && (
              <div className="route-anchor__favorite">
                <HeartStraightIcon
                  size={18}
                  weight="fill"
                  className="route-anchor__favorite__icon"
                />
              </div>
            )}
          </div>
        </Link>
      </FocusItem>
    </div>
  );
};
