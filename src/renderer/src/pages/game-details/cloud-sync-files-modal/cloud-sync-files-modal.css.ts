import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

export const mappingMethods = style({
  display: "grid",
  gap: `${SPACING_UNIT}px`,
  gridTemplateColumns: "repeat(2, 1fr)",
});

export const fileList = style({
  listStyle: "none",
  margin: "0",
  padding: "0",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
  marginTop: `${SPACING_UNIT * 2}px`,
});

export const fileItem = style({
  flex: 1,
  color: vars.color.muted,
  textDecoration: "underline",
  display: "flex",
  cursor: "pointer",
});
