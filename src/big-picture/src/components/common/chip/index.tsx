import "./styles.scss";

import cn from "classnames";
import { Typography } from "../typography";
import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

const variants = {
  solid: "chips--solid",
  ghost: "chips--ghost",
};

export interface ChipProps {
  label: string;
  color: string;
  icon?: ReactNode;
  variant?: keyof typeof variants;
  onRemove?: () => void;
}

export interface ColorDotProps {
  color: string;
}

export function ColorDot({ color }: Readonly<ColorDotProps>) {
  return (
    <div className="chips__content__color" style={{ backgroundColor: color }} />
  );
}

export function Chip({
  label,
  color,
  icon,
  variant = "solid",
  onRemove,
}: Readonly<ChipProps>) {
  return (
    <div className={cn("chips", variants[variant])}>
      <div className="chips__content">
        {icon && <div className="chips__content__icon">{icon}</div>}

        {color && <ColorDot color={color} />}

        <Typography variant="body" className="chips__content__label">
          {label}
        </Typography>
      </div>

      <button className="chips__close-button" onClick={onRemove}>
        <XIcon size={14} />
      </button>
    </div>
  );
}
