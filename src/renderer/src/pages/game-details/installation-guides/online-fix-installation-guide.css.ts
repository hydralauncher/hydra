import { SPACING_UNIT } from "@renderer/theme.css";
import { style } from "@vanilla-extract/css";

export const passwordField = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});
