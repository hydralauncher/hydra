import { appContainer } from "../../../app.css";
import { vars, SPACING_UNIT } from "../../../theme.css";
import { globalStyle, style } from "@vanilla-extract/css";

export const gameCover = style({
  transition: "all ease 0.2s",
  boxShadow: "0 8px 10px -2px rgba(0, 0, 0, 0.5)",
  width: "100%",
  position: "relative",
  ":before": {
    content: "",
    top: "0",
    left: "0",
    width: "100%",
    height: "172%",
    position: "absolute",
    background:
      "linear-gradient(35deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.07) 51.5%, rgba(255, 255, 255, 0.15) 54%, rgba(255, 255, 255, 0.15) 100%)",
    transition: "all ease 0.3s",
    transform: "translateY(-36%)",
    opacity: "0.5",
  },
});

export const game = style({
  transition: "all ease 0.2s",
  ":hover": {
    transform: "scale(1.05)",
  },
});

globalStyle(`${gameCover}:hover::before`, {
  opacity: "1",
  transform: "translateY(-20%)",
});

export const box = style({
  backgroundColor: vars.color.background,
  borderRadius: "4px",
  border: `solid 1px ${vars.color.border}`,
  padding: `${SPACING_UNIT * 2}px`,
});

export const sectionHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: `${SPACING_UNIT * 2}px`,
});

export const list = style({
  listStyle: "none",
  margin: "0",
  padding: "0",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
});

export const friend = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  alignItems: "center",
});

export const friendName = style({
  color: vars.color.muted,
  fontWeight: "bold",
  fontSize: vars.size.body,
});

export const rightContent = style({
  width: "100%",
  height: "100%",
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  flexDirection: "column",
  transition: "all ease 0.2s",
  "@media": {
    "(min-width: 1024px)": {
      maxWidth: "300px",
      width: "100%",
    },
    "(min-width: 1280px)": {
      width: "100%",
      maxWidth: "400px",
    },
  },
});

export const listItem = style({
  display: "flex",
  cursor: "pointer",
  transition: "all ease 0.1s",
  color: vars.color.muted,
  width: "100%",
  overflow: "hidden",
  borderRadius: "4px",
  padding: `${SPACING_UNIT}px ${SPACING_UNIT}px`,
  gap: `${SPACING_UNIT * 2}px`,
  alignItems: "center",
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    textDecoration: "none",
  },
});

export const gamesGrid = style({
  listStyle: "none",
  margin: "0",
  padding: "0",
  display: "grid",
  gap: `${SPACING_UNIT * 2}px`,
  gridTemplateColumns: "repeat(2, 1fr)",
  "@container": {
    [`${appContainer}  (min-width: 900px)`]: {
      gridTemplateColumns: "repeat(4, 1fr)",
    },
    [`${appContainer}  (min-width: 1300px)`]: {
      gridTemplateColumns: "repeat(5, 1fr)",
    },
    [`${appContainer}  (min-width: 2000px)`]: {
      gridTemplateColumns: "repeat(6, 1fr)",
    },
    [`${appContainer}  (min-width: 2600px)`]: {
      gridTemplateColumns: "repeat(8, 1fr)",
    },
    [`${appContainer}  (min-width: 3000px)`]: {
      gridTemplateColumns: "repeat(12, 1fr)",
    },
  },
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

export const noGames = style({
  display: "flex",
  width: "100%",
  height: "100%",
  justifyContent: "center",
  alignItems: "center",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});

export const listItemImage = style({
  width: "32px",
  height: "32px",
  borderRadius: "4px",
  objectFit: "cover",
});

export const listItemDetails = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT / 2}px`,
  overflow: "hidden",
});

export const listItemTitle = style({
  fontWeight: "bold",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
});

export const listItemDescription = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
});

export const defaultAvatarWrapper = style({
  width: "32px",
  height: "32px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  border: `solid 1px ${vars.color.border}`,
  borderRadius: "4px",
});

export const achievementsProgressBar = style({
  width: "100%",
  height: "4px",
  transition: "all ease 0.2s",
  "::-webkit-progress-bar": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: "4px",
  },
  "::-webkit-progress-value": {
    backgroundColor: vars.color.muted,
    borderRadius: "4px",
  },
});
