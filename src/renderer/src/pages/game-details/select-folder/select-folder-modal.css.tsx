import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../../theme.css";

export const container = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
  width: "100%",
});

export const downloadsPathField = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});

export const hintText = style({
  fontSize: "12px",
  color: vars.color.bodyText,
});
