import { style } from "@vanilla-extract/css";

import { SPACING_UNIT } from "../../theme.css";

export const deleteActionsButtonsCtn = style({
  display: "flex",
  width: "100%",
  justifyContent: "end",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
});
