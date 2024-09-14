import { vars } from "../../../theme.css";
import { globalStyle, style } from "@vanilla-extract/css";

export const profileAvatarEditContainer = style({
  alignSelf: "center",
  width: "128px",
  height: "128px",
  display: "flex",
  borderRadius: "4px",
  color: vars.color.body,
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  position: "relative",
  border: `solid 1px ${vars.color.border}`,
  boxShadow: "0px 0px 5px 0px rgba(0, 0, 0, 0.7)",
  cursor: "pointer",
});

export const profileAvatar = style({
  height: "100%",
  width: "100%",
  objectFit: "cover",
  borderRadius: "4px",
  overflow: "hidden",
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
  opacity: "0",
});

globalStyle(`${profileAvatarEditContainer}:hover ${profileAvatarEditOverlay}`, {
  opacity: "1",
});
