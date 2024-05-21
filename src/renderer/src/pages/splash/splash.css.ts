import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";

export const main = style({
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: `${SPACING_UNIT * 3}px`,
  flex: "1",
  overflowY: "auto",
  alignItems: "center",
});

export const splashIcon = style({
  width: "75%",
});

export const updateInfoSection = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
  flex: "1",
  overflowY: "auto",
  alignItems: "center",
  justifyContent: "center",
});

export const progressBar = style({
  WebkitAppearance: "none",
  appearance: "none",
  borderRadius: "4px",
  width: "100%",
  border: `solid 1px ${vars.color.border}`,
  overflow: "hidden",
  height: "18px",
  "::-webkit-progress-value": {
    backgroundColor: vars.color.muted,
    transition: "width 0.2s",
  },
  "::-webkit-progress-bar": {
    backgroundColor: vars.color.darkBackground,
  },
});

export const progressBarText = style({
  zIndex: 2,
});
