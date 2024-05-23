import { SPACING_UNIT, vars, Z_INDEX } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const dropDownMenu = style({
  position: "relative",
  cursor: "pointer",
});

export const dropDownMenuTrigger = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  padding: "6px",
  borderRadius: "4px",
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});

export const dropDownMenuList = style({
  minWidth: "max-content",
  listStyle: "none",
  position: "absolute",
  top: "100%",
  width: "100%",
  backgroundColor: vars.color.background,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "5px",
  padding: "5px",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
  zIndex: Z_INDEX.dropDownMenu,
});

export const dropDownMenuOption = style({
  width: "100%",
  textAlign: "left",
  padding: "5px",
  cursor: "pointer",
  color: vars.color.bodyText,
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
});

export const dropDownMenuOptionSelected = style({
  backgroundColor: "rgba(255, 255, 255, 0.1)",
});

export const dropDownMenuOptionDisabled = style({
  color: vars.color.darkBackground,
  cursor: "not-allowed",
});

export const dropDownMenuListStart = style({
  left: 0,
});

export const dropDownMenuListEnd = style({
  right: 0,
});
