import "./styles.scss";

import { SpinnerIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { Link } from "react-router-dom";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { getContrastTextColor } from "../../../helpers";
import { FocusItem } from "..";
import type { FocusOverrides } from "../../../services";

const variants = {
  primary: "button--primary",
  secondary: "button--secondary",
  tertiary: "button--tertiary",
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
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  loading?: boolean;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: ReactNode;
  icon?: ReactNode;
  href?: string;
  iconPosition?: "left" | "right";
  target?: "_blank" | "_self" | "_parent" | "_top";
  className?: string;
  color?: string;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
}

function isExternalHref(href: string) {
  return (
    /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(href) || href.startsWith("mailto:")
  );
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
  className,
  color,
  style,
  focusId,
  focusNavigationOverrides,
  "aria-label": ariaLabel,
  ...props
}: Readonly<ButtonProps>) {
  const buttonClassName = cn(
    "button",
    variants[variant],
    sizes[size],
    className,
    {
      "button--disabled": disabled || loading,
    }
  );

  const buttonStyle = {
    ...style,
    ...(color
      ? {
          "--button-custom-color": color,
          "--button-custom-hover-color": `color-mix(in srgb, ${color} 80%, white)`,
          "--button-custom-text-color": getContrastTextColor(color),
        }
      : {}),
  } as CSSProperties;

  if (!href) {
    return (
      <FocusItem
        id={focusId}
        navigationOverrides={focusNavigationOverrides}
        asChild
      >
        <button
          onClick={onClick}
          disabled={disabled || loading}
          aria-busy={loading}
          aria-label={size === "icon" ? ariaLabel : undefined}
          className={buttonClassName}
          style={buttonStyle}
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

  const linkContent = (
    <>
      {icon && (
        <div
          className={`button__icon-container--${iconPosition} button__icon-container`}
        >
          {icon}
        </div>
      )}

      {children && <p className="button__text">{children}</p>}
    </>
  );

  if (target === "_blank" || isExternalHref(href)) {
    return (
      <FocusItem
        id={focusId}
        navigationOverrides={focusNavigationOverrides}
        asChild
      >
        <a
          href={href}
          target={target}
          rel={target === "_blank" ? "noreferrer" : undefined}
          aria-label={size === "icon" ? ariaLabel : undefined}
          className={buttonClassName}
          style={buttonStyle}
          onClick={onClick as never}
        >
          {linkContent}
        </a>
      </FocusItem>
    );
  }

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      asChild
    >
      <Link
        to={href}
        aria-label={size === "icon" ? ariaLabel : undefined}
        className={buttonClassName}
        style={buttonStyle}
        onClick={onClick as never}
      >
        {linkContent}
      </Link>
    </FocusItem>
  );
}
