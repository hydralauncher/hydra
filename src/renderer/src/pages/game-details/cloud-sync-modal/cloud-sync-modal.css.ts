import { keyframes, style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

export const rotate = keyframes({
  "0%": { transform: "rotate(0deg)" },
  "100%": {
    transform: "rotate(360deg)",
  },
});

export const artifacts = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  flexDirection: "column",
  listStyle: "none",
  margin: "0",
  padding: "0",
});

export const artifactButton = style({
  display: "flex",
  textAlign: "left",
  flexDirection: "row",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  color: vars.color.body,
  padding: `${SPACING_UNIT * 2}px`,
  backgroundColor: vars.color.darkBackground,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "4px",
  justifyContent: "space-between",
});

export const syncIcon = style({
  animationName: rotate,
  animationDuration: "1s",
  animationIterationCount: "infinite",
  animationTimingFunction: "linear",
});

export const progress = style({
  width: "100%",
  height: "5px",
  "::-webkit-progress-bar": {
    backgroundColor: vars.color.darkBackground,
  },
  "::-webkit-progress-value": {
    backgroundColor: vars.color.muted,
  },
});
