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

export const container = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
  marginBottom: SPACING_UNIT * 2,
  paddingBottom: SPACING_UNIT * 2,
  borderBottom: `solid 1px ${vars.color.borderColor}`,
});

export const downloadsPathField = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
});

export const hintText = style({
  fontSize: 12,
  color: vars.color.bodyText,
});