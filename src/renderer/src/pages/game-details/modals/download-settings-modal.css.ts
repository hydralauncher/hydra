import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

export const container = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 3}px`,
  width: "100%",
});

export const downloadsPathField = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});

export const hintText = style({
  fontSize: "12px",
  color: vars.color.body,
});

export const downloaders = style({
  display: "grid",
  gap: `${SPACING_UNIT}px`,
  gridTemplateColumns: "repeat(2, 1fr)",
});

export const downloaderOption = style({
  position: "relative",
  ":only-child": {
    gridColumn: "1 / -1",
  },
});

export const downloaderIcon = style({
  position: "absolute",
  left: `${SPACING_UNIT * 2}px`,
});
