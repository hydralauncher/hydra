import { style } from "@vanilla-extract/css";

import { SPACING_UNIT } from "../../../theme.css";

export const collectionsContainer = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  flexDirection: "column",
  width: "50%",
  margin: "auto",
});

export const buttonsContainer = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  flexDirection: "row",
});

export const buttonSelect = style({
  flex: 3,
});

export const buttonRemove = style({
  flex: 1,
});
