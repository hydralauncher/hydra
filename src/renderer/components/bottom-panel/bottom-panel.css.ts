import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";

export const bottomPanel = style({
  width: "100%",
  borderTop: `solid 1px ${vars.color.borderColor}`,
  padding: `${SPACING_UNIT / 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "center",
  transition: "all ease 0.2s",
  justifyContent: "space-between",
  fontSize: vars.size.bodyFontSize,
});

export const downloadsButton = style({
  color: vars.color.bodyText,
  borderBottom: "1px solid transparent",
  ":hover": {
    borderBottom: `1px solid ${vars.color.bodyText}`,
    cursor: "pointer",
  },
});
