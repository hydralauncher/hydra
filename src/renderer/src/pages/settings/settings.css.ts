import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";
import { recipe } from "@vanilla-extract/recipes";

export const container = style({
  padding: "24px",
  width: "100%",
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  alignItems: "flex-start",
});

export const content = style({
  backgroundColor: vars.color.background,
  width: "100%",
  padding: `${SPACING_UNIT * 3}px`,
  border: `solid 1px ${vars.color.border}`,
  boxShadow: "0px 0px 15px 0px rgba(0, 0, 0, 0.5)",
  borderRadius: "4px",
  gap: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
  flex: "1",
});

export const sidebar = style({
  width: "200px",
  display: "flex",
  border: `solid 1px ${vars.color.border}`,
  borderRadius: "4px",
  backgroundColor: vars.color.background,
  minHeight: "500px",
  flexDirection: "column",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT}px`,
  gap: `${SPACING_UNIT * 2}px`,
  boxShadow: "0px 0px 15px 0px rgba(0, 0, 0, 0.5)",
});

export const menuGroup = style({
  gap: `${SPACING_UNIT}px`,
  display: "flex",
  flexDirection: "column",
});

export const menu = style({
  listStyle: "none",
  margin: "0",
  padding: "0",
  gap: `${SPACING_UNIT / 2}px`,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

export const menuItem = recipe({
  base: {
    transition: "all ease 0.1s",
    cursor: "pointer",
    textWrap: "nowrap",
    display: "flex",
    color: vars.color.muted,
    borderRadius: "4px",
    ":hover": {
      backgroundColor: "rgba(255, 255, 255, 0.15)",
    },
  },
  variants: {
    active: {
      true: {
        backgroundColor: "rgba(255, 255, 255, 0.1)",
      },
    },
    muted: {
      true: {
        opacity: vars.opacity.disabled,
        ":hover": {
          opacity: "1",
        },
      },
    },
  },
});

export const menuItemButton = style({
  color: "inherit",
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  cursor: "pointer",
  overflow: "hidden",
  width: "100%",
  padding: `9px ${SPACING_UNIT}px`,
});

export const menuItemButtonLabel = style({
  textOverflow: "ellipsis",
  overflow: "hidden",
});

export const categoryTitle = style({
  color: "#ff",
  fontWeight: "bold",
  fontSize: "18px",
  paddingBottom: `${SPACING_UNIT}px`,
});
