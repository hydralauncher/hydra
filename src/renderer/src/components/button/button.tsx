import cn from "classnames";
import { PlacesType, Tooltip } from "react-tooltip";

import "./button.scss";
import { forwardRef, useId } from "react";

export interface ButtonProps
  extends React.DetailedHTMLProps<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  tooltip?: string;
  tooltipPlace?: PlacesType;
  theme?: "primary" | "outline" | "dark" | "danger" | "cloud";
}

export const Button = forwardRef<HTMLButtonElement, Readonly<ButtonProps>>(
  function Button(
    {
      children,
      theme = "primary",
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
          className={cn("button", `button--${theme}`, className)}
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
