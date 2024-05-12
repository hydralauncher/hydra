import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const tagStyle = style({
  borderRadius: "3px",
  border: `1px solid ${vars.color.border}`,
  padding: `${SPACING_UNIT / 4}px ${SPACING_UNIT}px`,
});

export const tagText = style({
  fontSize: "11px",
});
