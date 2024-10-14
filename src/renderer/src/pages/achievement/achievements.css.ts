import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

export const HERO_HEIGHT = 300;

export const wrapper = style({
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  width: "100%",
  height: "100%",
  transition: "all ease 0.3s",
});

export const header = style({
  display: "flex",
  height: `${HERO_HEIGHT}px`,
  minHeight: `${HERO_HEIGHT}px`,
  gap: `${SPACING_UNIT}px`,
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

export const hero = style({
  position: "absolute",
  inset: "0",
  borderRadius: "4px",
  objectFit: "cover",
  cursor: "pointer",
  width: "100%",
  transition: "all ease 0.2s",
});

export const heroContent = style({
  padding: `${SPACING_UNIT * 2}px`,
  height: "100%",
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
});

export const gameLogo = style({
  width: 300,
});

export const container = style({
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "auto",
  zIndex: "1",
});

export const panel = recipe({
  base: {
    width: "100%",
    height: "100px",
    minHeight: "100px",
    padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
    backgroundColor: vars.color.darkBackground,
    display: "flex",
    flexDirection: "column",
    transition: "all ease 0.2s",
    borderBottom: `solid 1px ${vars.color.border}`,
    position: "sticky",
    overflow: "hidden",
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
  backgroundColor: vars.color.background,
});

export const listItem = style({
  display: "flex",
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
  },
  "::-webkit-progress-value": {
    backgroundColor: vars.color.muted,
  },
});

export const heroLogoBackdrop = style({
  width: "100%",
  height: "100%",
  background: "linear-gradient(0deg, rgba(0, 0, 0, 0.3) 60%, transparent 100%)",
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
});

export const heroImageSkeleton = style({
  height: "300px",
  "@media": {
    "(min-width: 1250px)": {
      height: "350px",
    },
  },
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
