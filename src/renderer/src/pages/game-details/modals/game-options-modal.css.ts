import { style } from "@vanilla-extract/css";

import { SPACING_UNIT } from "../../../theme.css";

export const optionsContainer = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  flexDirection: "column",
});

export const gameOptionHeader = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});

export const gameOptionHeaderDescription = style({
  fontWeight: "400",
});

export const gameOptionRow = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});
