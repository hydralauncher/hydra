import "./styles.scss";

import { HeartStraightIcon } from "@phosphor-icons/react";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { FocusItem } from "..";
import type { FocusItemActions } from "../../../types";
import type { FocusOverrides } from "../../../services";

export interface RouteAnchorProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  label: string;
  icon: ReactNode | string;
  subtitle?: string | null;
  href: string;
  active?: boolean;
  disabled?: boolean;
  isFavorite?: boolean;
  focusId?: string;
  focusNavigationOrder?: number;
  focusNavigationOverrides?: FocusOverrides;
  focusActions?: FocusItemActions;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export const RouteAnchor = ({
  href,
  label,
  icon,
  subtitle,
  active = false,
  disabled = false,
  isFavorite = false,
  focusId,
  focusNavigationOrder,
  focusNavigationOverrides,
  focusActions,
  onContextMenu,
  ...props
}: Readonly<RouteAnchorProps>) => {
  const isGameIcon = typeof icon === "string";

  return (
    <div
      className={`state-wrapper ${disabled ? "state-wrapper--disabled" : ""} ${active ? "state-wrapper--active" : ""}`}
    >
      <FocusItem
        id={focusId}
        actions={focusActions}
        navigationOrder={focusNavigationOrder}
        navigationOverrides={focusNavigationOverrides}
      >
        <Link to={href} onContextMenu={onContextMenu} {...props}>
          <div
            className={`route-anchor ${active ? "route-anchor--active" : ""} ${!isGameIcon ? "route-anchor--extra-padding" : ""} ${subtitle ? "route-anchor--with-subtitle" : ""}`}
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
            <div className="route-anchor__content">
              <div className="route-anchor__label">{label}</div>

              {subtitle && (
                <div className="route-anchor__subtitle">{subtitle}</div>
              )}
            </div>

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
