import "./styles.scss";

import cn from "classnames";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  color?: string;
}

export function Divider({
  orientation = "horizontal",
  color,
}: Readonly<DividerProps>) {
  return (
    <div
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
