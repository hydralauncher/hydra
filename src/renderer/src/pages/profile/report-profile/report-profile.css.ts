import { SPACING_UNIT, vars } from "../../../theme.css";
import { style } from "@vanilla-extract/css";

export const reportButton = style({
  alignSelf: "flex-end",
  color: vars.color.muted,
  gap: `${SPACING_UNIT}px`,
  display: "flex",
  cursor: "pointer",
  alignItems: "center",
  fontSize: "12px",
});
