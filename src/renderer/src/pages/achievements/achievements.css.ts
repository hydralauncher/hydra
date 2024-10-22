import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

export const HERO_HEIGHT = 150;
const LOGO_HEIGHT = 100;
const LOGO_MAX_WIDTH = 200;

export const wrapper = style({
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  width: "100%",
  height: "100%",
  transition: "all ease 0.3s",
});

export const hero = style({
  width: "100%",
  height: `${HERO_HEIGHT}px`,
  minHeight: `${HERO_HEIGHT}px`,
  display: "flex",
  flexDirection: "column",
  position: "relative",
  transition: "all ease 0.2s",
  "@media": {
    "(min-width: 1250px)": {
      height: "350px",
      minHeight: "350px",
    },
  },
});

export const heroImage = style({
  width: "100%",
  height: `${HERO_HEIGHT}px`,
  minHeight: `${HERO_HEIGHT}px`,
  objectFit: "cover",
  objectPosition: "top",
  transition: "all ease 0.2s",
  position: "absolute",
  zIndex: "0",
  filter: "blur(5px)",
  "@media": {
    "(min-width: 1250px)": {
      objectPosition: "center",
      height: "350px",
      minHeight: "350px",
    },
  },
});

export const heroContent = style({
  padding: `${SPACING_UNIT * 2}px`,
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
});

export const gameLogo = style({
  width: LOGO_MAX_WIDTH,
  height: LOGO_HEIGHT,
  objectFit: "contain",
  transition: "all ease 0.2s",
  ":hover": {
    transform: "scale(1.05)",
  },
});

export const container = style({
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "auto",
  zIndex: "1",
});

export const tableHeader = recipe({
  base: {
    width: "100%",
    backgroundColor: vars.color.darkBackground,
    transition: "all ease 0.2s",
    borderBottom: `solid 1px ${vars.color.border}`,
    position: "sticky",
    top: "0",
    zIndex: "1",
  },
  variants: {
    stuck: {
      true: {
        boxShadow: "0px 0px 15px 0px rgba(0, 0, 0, 0.8)",
      },
    },
  },
});

export const list = style({
  listStyle: "none",
  margin: "0",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
  padding: `${SPACING_UNIT * 2}px`,
  width: "100%",
  backgroundColor: vars.color.background,
});

export const listItem = style({
  transition: "all ease 0.1s",
  color: vars.color.muted,
  width: "100%",
  overflow: "hidden",
  borderRadius: "4px",
  padding: `${SPACING_UNIT}px ${SPACING_UNIT}px`,
  gap: `${SPACING_UNIT * 2}px`,
  alignItems: "center",
  textAlign: "left",
  ":hover": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    textDecoration: "none",
  },
});

export const listItemImage = recipe({
  base: {
    width: "54px",
    height: "54px",
    borderRadius: "4px",
    objectFit: "cover",
  },
  variants: {
    unlocked: {
      false: {
        filter: "grayscale(100%)",
      },
    },
  },
});

export const achievementsProgressBar = style({
  width: "100%",
  height: "8px",
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

export const heroLogoBackdrop = style({
  width: "100%",
  height: "100%",
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
});

export const heroImageSkeleton = style({
  height: "150px",
});

export const heroPanelSkeleton = style({
  width: "100%",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "center",
  backgroundColor: vars.color.background,
  height: "72px",
  borderBottom: `solid 1px ${vars.color.border}`,
});

export const listItemSkeleton = style({
  width: "100%",
  overflow: "hidden",
  borderRadius: "4px",
  padding: `${SPACING_UNIT}px ${SPACING_UNIT}px`,
  gap: `${SPACING_UNIT * 2}px`,
});

export const profileAvatar = style({
  height: "54px",
  width: "54px",
  borderRadius: "4px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  position: "relative",
  objectFit: "cover",
});

export const profileAvatarSmall = style({
  height: "32px",
  width: "32px",
  borderRadius: "4px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: vars.color.background,
  position: "relative",
  objectFit: "cover",
});

export const subscriptionRequiredButton = style({
  textDecoration: "none",
  display: "flex",
  justifyContent: "center",
  width: "100%",
  gap: `${SPACING_UNIT / 2}px`,
  color: vars.color.body,
  cursor: "pointer",
  ":hover": {
    textDecoration: "underline",
  },
});
