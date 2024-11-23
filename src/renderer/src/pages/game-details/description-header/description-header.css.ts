import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

export const descriptionHeader = style({
  width: "100%",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: vars.color.background,
  height: "72px",
});

export const descriptionHeaderInfo = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  flexDirection: "column",
});
