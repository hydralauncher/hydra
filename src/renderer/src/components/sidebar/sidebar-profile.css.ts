import { createVar, style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";

export const profileContainerBackground = createVar();

export const profileContainer = style({
  background: profileContainerBackground,
  position: "relative",
  cursor: "pointer",
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});

export const profileButton = style({
  display: "flex",
  cursor: "pointer",
  transition: "all ease 0.1s",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  color: vars.color.muted,
  borderBottom: `solid 1px ${vars.color.border}`,
  boxShadow: "0px 0px 15px 0px rgb(0 0 0 / 70%)",
  width: "100%",
  zIndex: "10",
});

export const profileButtonContent = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT + SPACING_UNIT / 2}px`,
  height: "40px",
  width: "100%",
});

export const profileAvatar = style({
  width: "35px",
  height: "35px",
  borderRadius: "50%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  border: `solid 1px ${vars.color.border}`,
  position: "relative",
  objectFit: "cover",
});

export const profileButtonInformation = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  flex: "1",
  minWidth: 0,
});

export const statusBadge = style({
  width: "9px",
  height: "9px",
  borderRadius: "50%",
  backgroundColor: vars.color.danger,
  position: "absolute",
  bottom: "-2px",
  right: "-3px",
  zIndex: "1",
});

export const profileButtonTitle = style({
  fontWeight: "bold",
  fontSize: vars.size.body,
  width: "100%",
  textAlign: "left",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

export const friendRequestContainer = style({
  position: "absolute",
  padding: "8px",
  right: `${SPACING_UNIT}px`,
  display: "flex",
  top: 0,
  bottom: 0,
  alignItems: "center",
});

export const friendRequestButton = style({
  color: vars.color.success,
  cursor: "pointer",
  borderRadius: "50%",
  overflow: "hidden",
  width: "40px",
  height: "40px",
  ":hover": {
    color: vars.color.muted,
  },
});
