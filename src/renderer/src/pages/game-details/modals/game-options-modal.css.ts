import { style } from "@vanilla-extract/css";
import { SPACING_UNIT } from "../../../theme.css";

export const optionsContainer = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  flexDirection: "column",
});

export const downloadSourceField = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});
