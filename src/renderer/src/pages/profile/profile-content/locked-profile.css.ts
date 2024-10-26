import { SPACING_UNIT } from "../../../theme.css";

import { style } from "@vanilla-extract/css";

export const container = style({
  display: "flex",
  width: "100%",
  height: "100%",
  justifyContent: "center",
  alignItems: "center",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});

export const lockIcon = style({
  width: "60px",
  height: "60px",
  borderRadius: "50%",
  backgroundColor: "rgba(255, 255, 255, 0.06)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: `${SPACING_UNIT * 2}px`,
});
