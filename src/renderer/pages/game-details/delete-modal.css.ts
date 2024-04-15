import { SPACING_UNIT } from "@renderer/theme.css";
import { style } from "@vanilla-extract/css";

export const deleteActionsButtonsCtn = style({
  display: "flex",
  width: "100%",
  justifyContent: "end",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
});
