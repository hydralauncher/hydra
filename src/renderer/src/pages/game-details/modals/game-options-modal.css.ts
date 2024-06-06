import { style } from "@vanilla-extract/css";
import { SPACING_UNIT } from "../../../theme.css";

export const optionsContainer = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  flexDirection: "column",
});

export const gameOptionRow = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});
