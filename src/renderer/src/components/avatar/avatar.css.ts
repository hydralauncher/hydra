import { style } from "@vanilla-extract/css";

import { vars } from "../../theme.css";

export const profileAvatar = style({
  borderRadius: "4px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  border: `solid 1px ${vars.color.border}`,
  cursor: "pointer",
  color: vars.color.muted,
  position: "relative",
});

export const profileAvatarImage = style({
  height: "100%",
  width: "100%",
  objectFit: "cover",
  overflow: "hidden",
  borderRadius: "4px",
});
