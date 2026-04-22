import cn from "classnames";
import "./style.scss";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  color?: string;
}

export function Divider({
  orientation = "horizontal",
  color,
}: Readonly<DividerProps>) {
  return (
    <div className="divider-container">
      <div
        className={cn("divider", {
          [`divider--${orientation}`]: true,
        })}
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
