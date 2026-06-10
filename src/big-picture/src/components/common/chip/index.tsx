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
  color?: string;
  icon?: ReactNode;
  variant?: keyof typeof variants;
  onClick?: () => void;
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
  onClick,
  onRemove,
  focusId,
  focusNavigationOverrides,
}: Readonly<ChipProps>) {
  const content = (
    <div className="chips__content">
      {icon && <div className="chips__content__icon">{icon}</div>}

      {color && <ColorDot color={color} />}

      <Typography variant="body" className="chips__content__label">
        {label}
      </Typography>
    </div>
  );

  const removableChip = (
    <div className={cn("chips", variants[variant])}>
      {content}

      <button type="button" className="chips__close-button" onClick={onRemove}>
        <XIcon size={14} />
      </button>
    </div>
  );

  const actionChip = (
    <button
      type="button"
      className={cn("chips", variants[variant])}
      onClick={onClick}
    >
      {content}
    </button>
  );

  const staticChip = (
    <div className={cn("chips", variants[variant])}>{content}</div>
  );

  const chip = onRemove ? removableChip : onClick ? actionChip : staticChip;
  const actions = onClick
    ? { primary: () => onClick() }
    : onRemove
      ? { primary: () => onRemove() }
      : undefined;

  return focusId ? (
    <FocusItem
      id={focusId}
      actions={actions}
      navigationOverrides={focusNavigationOverrides}
      asChild
    >
      {chip}
    </FocusItem>
  ) : (
    chip
  );
}
