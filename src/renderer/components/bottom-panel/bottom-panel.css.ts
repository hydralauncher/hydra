import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const bottomPanel = style({
  width: "100%",
  borderTop: `solid 1px ${vars.color.borderColor}`,
  padding: `${SPACING_UNIT / 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "center",
  transition: "all ease 0.2s",
  justifyContent: "space-between",
  fontSize: vars.size.bodyFontSize,
  zIndex: "1",
});

export const downloadsButton = style({
  cursor: "pointer",
  color: vars.color.bodyText,
  ":hover": {
    textDecoration: "underline",
  },
});
