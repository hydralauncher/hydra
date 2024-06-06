import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

export const heroPanelAction = style({
  border: `solid 1px ${vars.color.muted}`,
});

export const separator = style({
  width: "1px",
  backgroundColor: vars.color.muted,
  margin: `${SPACING_UNIT / 2}px 0`,
});
