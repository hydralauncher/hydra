import { SpinnerIcon } from "@phosphor-icons/react";
import { Link } from "@renderer/components";

import cn from "classnames";
import "./style.scss";

const variants = {
  primary: "bp-button--primary",
  secondary: "bp-button--secondary",
  rounded: "bp-button--rounded",
  danger: "bp-button--danger",
  link: "bp-button--link",
};

const sizes = {
  icon: "bp-button--icon",
  small: "bp-button--small",
  medium: "bp-button--medium",
  large: "bp-button--large",
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
  ...props
}: Readonly<ButtonProps>) {
  if (!href) {
    return (
      <button
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading}
        aria-label={size === "icon" ? ariaLabel : undefined}
        className={`bp-button ${variants[variant]} ${sizes[size]} ${
          disabled || loading ? "bp-button--disabled" : ""
        }`}
        {...props}
      >
        {loading && (
          <div
            className={`bp-button__icon-container--${iconPosition} bp-button__icon-container`}
          >
            <SpinnerIcon size={20} className="bp-button__loading-icon" />
          </div>
        )}

        {icon && !loading && (
          <div
            className={`bp-button__icon-container--${iconPosition} bp-button__icon-container`}
          >
            {icon}
          </div>
        )}

        {children && (!loading || typeof children === "string") && (
          <p className="bp-button__text">{children}</p>
        )}
      </button>
    );
  }

  return (
    <Link
      to={href ?? ""}
      target={target}
      aria-label={size === "icon" ? ariaLabel : undefined}
      className={cn("bp-button", variants[variant], sizes[size], {
        "bp-button--disabled": disabled,
      })}
    >
      {icon && (
        <div
          className={`bp-button__icon-container--${iconPosition} bp-button__icon-container`}
        >
          {icon}
        </div>
      )}

      {children && <p className="bp-button__text">{children}</p>}
    </Link>
  );
}
