import { style } from "@vanilla-extract/css";

import { SPACING_UNIT } from "../../../theme.css";

export const mappingMethods = style({
  display: "grid",
  gap: `${SPACING_UNIT}px`,
  gridTemplateColumns: "repeat(2, 1fr)",
});
