import { SPACING_UNIT, vars } from "../../../theme.css";
import { style } from "@vanilla-extract/css";

export const profileContentBox = style({
  display: "flex",
  flexDirection: "column",
});

export const profileAvatarContainer = style({
  width: "96px",
  minWidth: "96px",
  height: "96px",
  borderRadius: "50%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  overflow: "hidden",
  border: `solid 1px ${vars.color.border}`,
  boxShadow: "0px 0px 5px 0px rgba(0, 0, 0, 0.7)",
  zIndex: 1,
});

export const profileAvatar = style({
  height: "100%",
  width: "100%",
  objectFit: "cover",
  overflow: "hidden",
});

export const profileInformation = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
  alignItems: "flex-start",
  color: "#c0c1c7",
  zIndex: 1,
  overflow: "hidden",
});

export const profileDisplayName = style({
  fontWeight: "bold",
  overflow: "hidden",
  textOverflow: "ellipsis",
  width: "100%",
});
