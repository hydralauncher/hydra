import { SPACING_UNIT } from "@renderer/theme.css";
import { style } from "@vanilla-extract/css";

export const container = style({
  display: "flex",
  flexDirection: "column",
  width: "100%",
});

export const sectionHeader = style({
  display: "flex",
  justifyContent: "space-between",
  width: "100%",
  gap: "12px",
  padding: `${SPACING_UNIT * 4}px 0`,
});

export const patchNoteList = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 0.75}px`,
});

export const releaseAssets = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
});
