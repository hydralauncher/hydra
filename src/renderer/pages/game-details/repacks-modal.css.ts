import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "@renderer/theme.css";

export const repacks = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  flexDirection: "column",
});

export const repackButton = style({
  display: "flex",
  textAlign: "left",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: `${SPACING_UNIT}px`,
  color: vars.color.bodyText,
  padding: `${SPACING_UNIT * 2}px`,
});
