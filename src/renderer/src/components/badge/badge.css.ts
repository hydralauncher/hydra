import { style } from "@vanilla-extract/css";
import { SPACING_UNIT } from "../../theme.css";

export const badge = style({
  color: "#c0c1c7",
  fontSize: "10px",
  padding: `${SPACING_UNIT / 2}px ${SPACING_UNIT}px`,
  border: "solid 1px #c0c1c7",
  borderRadius: "4px",
  display: "flex",
  alignItems: "center",
});
