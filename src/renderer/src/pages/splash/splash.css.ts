import { style } from "@vanilla-extract/css";
import { SPACING_UNIT } from "../../theme.css";

export const main = style({
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 3}px`,
  padding: `${SPACING_UNIT * 3}px`,
  flex: "1",
  overflowY: "auto",
  alignItems: "center",
});

export const splashIcon = style({
  width: "250px",
});
