import "./styles.scss";

import cn from "classnames";
import { Typography } from "../typography";
import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { FocusOverrides } from "../../../services";
import { FocusItem } from "../focus-item";

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
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
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
  focusId,
  focusNavigationOverrides,
}: Readonly<ChipProps>) {
  const chip = (
    <div className={cn("chips", variants[variant])}>
      <div className="chips__content">
        {icon && <div className="chips__content__icon">{icon}</div>}

        {color && <ColorDot color={color} />}

        <Typography variant="body" className="chips__content__label">
          {label}
        </Typography>
      </div>

      <button type="button" className="chips__close-button" onClick={onRemove}>
        <XIcon size={14} />
      </button>
    </div>
  );

  return focusId ? (
    <FocusItem
      id={focusId}
      actions={{ primary: () => onRemove?.() }}
      navigationOverrides={focusNavigationOverrides}
      asChild
    >
      {chip}
    </FocusItem>
  ) : (
    chip
  );
}
