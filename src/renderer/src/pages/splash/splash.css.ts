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

export const progressBarContainer = style({
  width: "100%",
  borderRadius: "24px",
  display: "flex",
  alignItems: "center",
  position: "relative",
  justifyContent: "center",
  backgroundColor: vars.color.darkBackground,
  border: `solid 1px ${vars.color.border}`,
  overflow: "hidden",
});

export const progressBarFill = style({
  position: "absolute",
  transition: "width 0.1s",
  height: "100%",
  left: 0,
  background: vars.color.background,
});

export const progressBarText = style({
  zIndex: 2,
});
