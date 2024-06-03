import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";

export const downloadSourceField = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});

export const downloadSources = style({
  padding: "0",
  gap: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
});

export const downloadSourceItem = style({
  display: "flex",
  flexDirection: "column",
  backgroundColor: vars.color.darkBackground,
  borderRadius: "8px",
  padding: `${SPACING_UNIT * 2}px`,
  gap: `${SPACING_UNIT}px`,
  border: `solid 1px ${vars.color.border}`,
});

export const downloadSourceItemHeader = style({
  marginBottom: `${SPACING_UNIT}px`,
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});

export const downloadSourceItemTitle = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  alignItems: "center",
});
