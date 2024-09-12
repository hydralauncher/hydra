import { SPACING_UNIT } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const wrapper = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 3}px`,
});
