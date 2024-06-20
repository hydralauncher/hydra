import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";

export const bottomPanel = style({
  width: "100%",
  borderTop: `solid 1px ${vars.color.border}`,
  backgroundColor: vars.color.background,
  padding: `${SPACING_UNIT / 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "center",
  transition: "all ease 0.2s",
  justifyContent: "space-between",
  position: "relative",
  zIndex: vars.zIndex.bottomPanel,
});

export const downloadsButton = style({
  color: vars.color.body,
  borderBottom: "1px solid transparent",
  ":hover": {
    borderBottom: `1px solid ${vars.color.body}`,
    cursor: "pointer",
  },
});
