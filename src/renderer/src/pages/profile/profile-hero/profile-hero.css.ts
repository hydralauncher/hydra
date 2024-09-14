import { SPACING_UNIT, vars } from "../../../theme.css";
import { style } from "@vanilla-extract/css";

export const profileContentBox = style({
  display: "flex",
  flexDirection: "column",
});

export const profileAvatarButton = style({
  width: "96px",
  minWidth: "96px",
  height: "96px",
  borderRadius: "4px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  overflow: "hidden",
  border: `solid 1px ${vars.color.border}`,
  boxShadow: "0px 0px 5px 0px rgba(0, 0, 0, 0.7)",
  cursor: "pointer",
  transition: "all ease 0.3s",
  color: vars.color.muted,
  ":hover": {
    boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.7)",
  },
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
  display: "flex",
  alignItems: "center",
  position: "relative",
});

export const heroPanel = style({
  width: "100%",
  height: "72px",
  minHeight: "72px",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 3}px`,
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  justifyContent: "space-between",
  backdropFilter: `blur(10px)`,
  borderTop: `solid 1px rgba(255, 255, 255, 0.1)`,
  boxShadow: "0px 0px 15px 0px rgba(0, 0, 0, 0.5)",
  backgroundColor: "rgba(0, 0, 0, 0.3)",
});

export const userInformation = style({
  display: "flex",
  padding: `${SPACING_UNIT * 4}px ${SPACING_UNIT * 3}px`,
  alignItems: "center",
  gap: `${SPACING_UNIT * 2}px`,
});

export const currentGameWrapper = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT / 2}px`,
});

export const currentGameDetails = style({
  display: "flex",
  flexDirection: "row",
  gap: `${SPACING_UNIT}px`,
  alignItems: "center",
});
