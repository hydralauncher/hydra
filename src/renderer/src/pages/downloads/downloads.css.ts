import { style } from "@vanilla-extract/css";

import { SPACING_UNIT } from "../../theme.css";

export const downloadsContainer = style({
  display: "flex",
  padding: `${SPACING_UNIT * 3}px`,
  flexDirection: "column",
  width: "100%",
});

export const downloadGroups = style({
  display: "flex",
  gap: `${SPACING_UNIT * 3}px`,
  flexDirection: "column",
});

export const arrowIcon = style({
  width: "60px",
  height: "60px",
  borderRadius: "50%",
  backgroundColor: "rgba(255, 255, 255, 0.06)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: `${SPACING_UNIT * 2}px`,
});

export const noDownloads = style({
  display: "flex",
  width: "100%",
  height: "100%",
  justifyContent: "center",
  alignItems: "center",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});
