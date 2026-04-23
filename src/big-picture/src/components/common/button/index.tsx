import { SpinnerIcon } from "@phosphor-icons/react";
import { Link } from "@renderer/components";
import { FocusItem } from "../focus-item";

import cn from "classnames";
import "./style.scss";
import type { NavigationNodeState } from "../../../services/navigation.service";

const variants = {
  primary: "button--primary",
  secondary: "button--secondary",
  rounded: "button--rounded",
  danger: "button--danger",
  link: "button--link",
};

const sizes = {
  icon: "button--icon",
  small: "button--small",
  medium: "button--medium",
  large: "button--large",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  iconPosition?: "left" | "right";
  target?: "_blank" | "_self" | "_parent" | "_top";
  className?: string;
  navigationState?: NavigationNodeState;
}

export function Button({
  loading = false,
  disabled = false,
  size = "medium",
  variant = "primary",
  iconPosition = "left",
  href,
  icon,
  onClick,
  children,
  target,
  "aria-label": ariaLabel,
  navigationState = "active",
  ...props
}: Readonly<ButtonProps>) {
  if (!href) {
    return (
      <FocusItem navigationState={navigationState}>
        <button
          onClick={onClick}
          disabled={disabled || loading}
          aria-busy={loading}
          aria-label={size === "icon" ? ariaLabel : undefined}
          className={`button ${variants[variant]} ${sizes[size]} ${
            disabled || loading ? "button--disabled" : ""
          }`}
          {...props}
        >
          {loading && (
            <div
              className={`button__icon-container--${iconPosition} button__icon-container`}
            >
              <SpinnerIcon size={20} className="button__loading-icon" />
            </div>
          )}

          {icon && !loading && (
            <div
              className={`button__icon-container--${iconPosition} button__icon-container`}
            >
              {icon}
            </div>
          )}

          {children && (!loading || typeof children === "string") && (
            <p className="button__text">{children}</p>
          )}
        </button>
      </FocusItem>
    );
  }

  return (
    <FocusItem>
      <Link
        to={href ?? ""}
        target={target}
        aria-label={size === "icon" ? ariaLabel : undefined}
        className={cn("button", variants[variant], sizes[size], {
          "button--disabled": disabled,
        })}
      >
        {icon && (
          <div
            className={`button__icon-container--${iconPosition} button__icon-container`}
          >
            {icon}
          </div>
        )}

        {children && <p className="button__text">{children}</p>}
      </Link>
    </FocusItem>
  );
}
