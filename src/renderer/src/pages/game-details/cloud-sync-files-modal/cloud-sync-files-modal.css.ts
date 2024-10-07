import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

export const artifacts = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  flexDirection: "column",
  listStyle: "none",
  margin: "0",
  padding: "0",
});

export const artifactButton = style({
  display: "flex",
  textAlign: "left",
  flexDirection: "row",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  color: vars.color.body,
  padding: `${SPACING_UNIT * 2}px`,
  backgroundColor: vars.color.darkBackground,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "4px",
  justifyContent: "space-between",
});
