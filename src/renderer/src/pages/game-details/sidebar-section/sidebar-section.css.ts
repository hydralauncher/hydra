import { recipe } from "@vanilla-extract/recipes";
import { SPACING_UNIT, vars } from "../../../theme.css";
import { style } from "@vanilla-extract/css";

export const sidebarSectionButton = style({
  height: "72px",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "center",
  backgroundColor: vars.color.background,
  color: vars.color.muted,
  width: "100%",
  cursor: "pointer",
  transition: "all ease 0.2s",
  gap: `${SPACING_UNIT}px`,
  fontSize: "14px",
  fontWeight: "bold",
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  ":active": {
    opacity: vars.opacity.active,
  },
});

export const chevron = recipe({
  base: {
    transition: "transform ease 0.2s",
  },
  variants: {
    open: {
      true: {
        transform: "rotate(180deg)",
      },
    },
  },
});
