import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";

export const panel = style({
  width: "100%",
  height: "72px",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 3}px`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  transition: "all ease 0.2s",
  borderBottom: `solid 1px ${vars.color.borderColor}`,
  boxShadow: "0px 0px 15px 0px #000000",
});

export const content = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
  fontSize: vars.size.bodyFontSize,
});

export const actions = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});

export const downloadDetailsRow = style({
  gap: `${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "flex-end",
});
