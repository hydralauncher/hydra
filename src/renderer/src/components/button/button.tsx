import cn from "classnames";
import { PlacesType, Tooltip } from "react-tooltip";

import "./button.scss";
import { forwardRef, useId } from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip?: string;
  tooltipPlace?: PlacesType;
  theme?: "primary" | "outline" | "dark" | "danger" | "cloud";
  /** `small` fits compact rows (list headers, card footers). */
  size?: "medium" | "small";
}

export const Button = forwardRef<HTMLButtonElement, Readonly<ButtonProps>>(
  function Button(
    {
      children,
      theme = "primary",
      size = "medium",
      className,
      tooltip,
      tooltipPlace = "top",
      ...props
    },
    ref
  ) {
    const id = useId();

    const tooltipProps = tooltip
      ? {
          "data-tooltip-id": id,
          "data-tooltip-place": tooltipPlace,
          "data-tooltip-content": tooltip,
        }
      : {};

    return (
      <>
        <button
          ref={ref}
          type="button"
          className={cn(
            "button",
            `button--${theme}`,
            { "button--small": size === "small" },
            className
          )}
          {...props}
          {...tooltipProps}
        >
          {children}
        </button>

        {tooltip && <Tooltip id={id} />}
      </>
    );
  }
);
