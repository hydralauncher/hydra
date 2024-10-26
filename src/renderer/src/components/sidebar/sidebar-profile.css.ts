import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";

export const profileContainer = style({
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  padding: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px`,
});

export const profileButton = style({
  display: "flex",
  cursor: "pointer",
  transition: "all ease 0.1s",
  color: vars.color.muted,
  width: "100%",
  overflow: "hidden",
  borderRadius: "4px",
  padding: `${SPACING_UNIT}px ${SPACING_UNIT}px`,
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});

export const profileButtonContent = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT + SPACING_UNIT / 2}px`,
  width: "100%",
});

export const profileButtonInformation = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  flex: "1",
  minWidth: 0,
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

export const friendsButton = style({
  color: vars.color.muted,
  cursor: "pointer",
  borderRadius: "50%",
  width: "40px",
  minWidth: "40px",
  minHeight: "40px",
  height: "40px",
  backgroundColor: vars.color.background,
  position: "relative",
  transition: "all ease 0.3s",
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});

export const friendsButtonBadge = style({
  backgroundColor: vars.color.success,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  width: "20px",
  height: "20px",
  borderRadius: "50%",
  position: "absolute",
  top: "-5px",
  right: "-5px",
});
