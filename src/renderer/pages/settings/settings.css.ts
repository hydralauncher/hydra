import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { style } from "@vanilla-extract/css";

export const container = style({
  padding: "24px",
  width: "100%",
  display: "flex",
});

export const content = style({
  backgroundColor: vars.color.background,
  width: "100%",
  height: "100%",
  padding: `${SPACING_UNIT * 3}px`,
  border: `solid 1px ${vars.color.borderColor}`,
  boxShadow: "0px 0px 15px 0px #000000",
  borderRadius: "8px",
  gap: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
});

export const downloadsPathField = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
});
