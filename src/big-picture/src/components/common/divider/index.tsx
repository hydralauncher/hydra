import { forwardRef } from "react";
import "./styles.scss";

import cn from "classnames";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  color?: string;
}

export const Divider = forwardRef<HTMLDivElement, Readonly<DividerProps>>(
  ({ orientation = "horizontal", color }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("divider-container", {
          [`divider-container--${orientation}`]: true,
        })}
      >
      <div
        className={cn("divider", {
          [`divider--${orientation}`]: true,
        })}
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
);
