import { style } from "@vanilla-extract/css";

import { SPACING_UNIT } from "../../theme.css";

export const catalogueCategories = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});

export const content = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 3}px`,
  padding: `${SPACING_UNIT * 3}px`,
  flex: "1",
});

export const cards = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: `${SPACING_UNIT * 2}px`,
  transition: "all ease 0.2s",
});
