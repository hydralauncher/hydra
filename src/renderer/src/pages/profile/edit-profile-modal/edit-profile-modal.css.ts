import { vars } from "../../../theme.css";
import { globalStyle, style } from "@vanilla-extract/css";

export const profileAvatarEditContainer = style({
  alignSelf: "center",
  // width: "132px",
  // height: "132px",
  display: "flex",
  // borderRadius: "4px",
  color: vars.color.body,
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  position: "relative",
  cursor: "pointer",
});

export const profileAvatarEditOverlay = style({
  position: "absolute",
  width: "100%",
  height: "100%",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  color: vars.color.muted,
  zIndex: "1",
  cursor: "pointer",
  display: "flex",
  justifyContent: "center",
  transition: "all ease 0.2s",
  alignItems: "center",
  borderRadius: "4px",
  opacity: "0",
});

globalStyle(`${profileAvatarEditContainer}:hover ${profileAvatarEditOverlay}`, {
  opacity: "1",
});
