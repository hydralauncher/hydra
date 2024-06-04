import { SPACING_UNIT } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const downloadsContainer = style({
  display: "flex",
  padding: `${SPACING_UNIT * 3}px`,
  flexDirection: "column",
  width: "100%",
});

export const downloadGroups = style({
  display: "flex",
  gap: `${SPACING_UNIT * 3}px`,
  flexDirection: "column",
});
