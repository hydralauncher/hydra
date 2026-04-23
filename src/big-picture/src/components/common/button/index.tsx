import "./styles.scss";

import { Spinner } from "@phosphor-icons/react";
import cn from "classnames";
import { Link } from "react-router-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

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
}

function isExternalHref(href: string) {
  return /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(href) || href.startsWith("mailto:");
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
  "aria-label": ariaLabel,
  ...props
}: Readonly<ButtonProps>) {
  const buttonClassName = cn("button", variants[variant], sizes[size], className, {
    "button--disabled": disabled || loading,
  });

  if (!href) {
    return (
      <button
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading}
        aria-label={size === "icon" ? ariaLabel : undefined}
        className={buttonClassName}
        {...props}
      >
        {loading && (
          <div
            className={`button__icon-container--${iconPosition} button__icon-container`}
          >
            <Spinner size={20} className="button__loading-icon" />
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
      <a
        href={href}
        target={target}
        rel={target === "_blank" ? "noreferrer" : undefined}
        aria-label={size === "icon" ? ariaLabel : undefined}
        className={buttonClassName}
        onClick={onClick as never}
      >
        {linkContent}
      </a>
    );
  }

  return (
    <Link
      to={href}
      aria-label={size === "icon" ? ariaLabel : undefined}
      className={buttonClassName}
      onClick={onClick as never}
    >
      {linkContent}
    </Link>
  );
}
