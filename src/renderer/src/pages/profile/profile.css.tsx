import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const wrapper = style({
  padding: "24px",
  width: "100%",
  display: "flex",
  flexDirection: "column",
});

export const profileHeader = style({
  display: "flex",
  gap: `${SPACING_UNIT + SPACING_UNIT / 2}px`,
  alignItems: "center",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  color: vars.color.muted,
  borderRadius: "4px",
  border: `solid 1px ${vars.color.border}`,
  width: "100%",
});

export const profileAvatar = style({
  width: "96px",
  height: "96px",
  borderRadius: "50%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  position: "relative",
});

export const profileInformation = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
});

export const profileHeaderSkeleton = style({
  height: "200px",
});
