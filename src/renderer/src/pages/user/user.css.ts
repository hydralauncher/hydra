import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const wrapper = style({
  padding: "24px",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 3}px`,
});

export const profileContentBox = style({
  display: "flex",
  gap: `${SPACING_UNIT * 3}px`,
  alignItems: "center",
  borderRadius: "4px",
  border: `solid 1px ${vars.color.border}`,
  width: "100%",
  boxShadow: "0px 0px 15px 0px rgba(0, 0, 0, 0.7)",
  transition: "all ease 0.3s",
});

export const profileAvatarContainer = style({
  width: "96px",
  height: "96px",
  borderRadius: "50%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  position: "relative",
  overflow: "hidden",
  border: `solid 1px ${vars.color.border}`,
  boxShadow: "0px 0px 5px 0px rgba(0, 0, 0, 0.7)",
  zIndex: 1,
});

export const friendAvatarContainer = style({
  width: "35px",
  minWidth: "35px",
  height: "35px",
  borderRadius: "50%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  overflow: "hidden",
  border: `solid 1px ${vars.color.border}`,
  boxShadow: "0px 0px 5px 0px rgba(0, 0, 0, 0.7)",
});

export const friendListDisplayName = style({
  fontWeight: "bold",
  fontSize: vars.size.body,
  textAlign: "left",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

export const profileAvatarEditContainer = style({
  width: "128px",
  height: "128px",
  display: "flex",
  borderRadius: "50%",
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
});

export const profileAvatarEditOverlay = style({
  position: "absolute",
  width: "100%",
  height: "100%",
  backgroundColor: "#00000055",
  color: vars.color.muted,
  zIndex: 1,
  cursor: "pointer",
});

export const profileInformation = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
  alignItems: "flex-start",
  color: "#c0c1c7",
  zIndex: 1,
});

export const profileContent = style({
  display: "flex",
  height: "100%",
  flexDirection: "row",
  gap: `${SPACING_UNIT * 4}px`,
});

export const profileGameSection = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
});

export const friendsSection = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
});

export const contentSidebar = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 3}px`,
  "@media": {
    "(min-width: 768px)": {
      width: "100%",
      maxWidth: "150px",
    },
    "(min-width: 1024px)": {
      maxWidth: "250px",
      width: "100%",
    },
  },
});

export const feedGameIcon = style({
  height: "100%",
});

export const libraryGameIcon = style({
  width: "100%",
  height: "100%",
  borderRadius: "4px",
});

export const friendProfileIcon = style({
  height: "100%",
});

export const feedItem = style({
  color: vars.color.body,
  display: "flex",
  flexDirection: "row",
  gap: `${SPACING_UNIT * 2}px`,
  width: "100%",
  overflow: "hidden",
  height: "72px",
  transition: "all ease 0.2s",
  cursor: "pointer",
  zIndex: "1",
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});

export const gameListItem = style({
  color: vars.color.body,
  transition: "all ease 0.2s",
  cursor: "pointer",
  zIndex: "1",
  overflow: "hidden",
  padding: `${SPACING_UNIT + SPACING_UNIT / 2}px`,
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});

export const friendListItem = style({
  color: vars.color.body,
  display: "flex",
  flexDirection: "row",
  gap: `${SPACING_UNIT + SPACING_UNIT / 2}px`,
  width: "100%",
  height: "54px",
  padding: "0 8px",
  transition: "all ease 0.2s",
  cursor: "pointer",
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});

export const gameInformation = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: `${SPACING_UNIT / 2}px`,
});

export const profileHeaderSkeleton = style({
  height: "144px",
});

export const editProfileImageBadge = style({
  width: "28px",
  height: "28px",
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: vars.color.background,
  backgroundColor: vars.color.muted,
  position: "absolute",
  bottom: "0px",
  right: "0px",
  zIndex: "1",
});

export const telescopeIcon = style({
  width: "60px",
  height: "60px",
  borderRadius: "50%",
  backgroundColor: "rgba(255, 255, 255, 0.06)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: `${SPACING_UNIT * 2}px`,
});

export const noDownloads = style({
  display: "flex",
  width: "100%",
  height: "100%",
  justifyContent: "center",
  alignItems: "center",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});

export const signOutModalContent = style({
  display: "flex",
  width: "100%",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});

export const signOutModalButtonsContainer = style({
  display: "flex",
  width: "100%",
  justifyContent: "end",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  paddingTop: `${SPACING_UNIT}px`,
});

export const profileBackground = style({
  width: "100%",
  height: "100%",
  position: "absolute",
  objectFit: "cover",
  left: "0",
  top: "0",
  borderRadius: "4px",
});

export const friendRequestItem = style({
  color: vars.color.body,
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});

export const acceptRequestButton = style({
  cursor: "pointer",
  color: vars.color.body,
  width: "28px",
  height: "28px",
  ":hover": {
    color: vars.color.success,
  },
});

export const cancelRequestButton = style({
  cursor: "pointer",
  color: vars.color.body,
  width: "28px",
  height: "28px",
  ":hover": {
    color: vars.color.danger,
  },
});
