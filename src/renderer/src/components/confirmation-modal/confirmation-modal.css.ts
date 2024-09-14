import { SPACING_UNIT } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const actions = style({
  display: "flex",
  alignSelf: "flex-end",
  gap: `${SPACING_UNIT * 2}px`,
});

export const descriptionText = style({
  fontSize: "16px",
  lineHeight: "24px",
});
