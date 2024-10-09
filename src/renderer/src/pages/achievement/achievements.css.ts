import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

export const container = style({
  width: "100%",
  padding: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
});

export const header = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  width: "50%",
});

export const headerImage = style({
  borderRadius: "4px",
  objectFit: "cover",
  cursor: "pointer",
  height: "160px",
  transition: "all ease 0.2s",
  ":hover": {
    transform: "scale(1.05)",
  },
});

export const list = style({
  listStyle: "none",
  margin: "0",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
  padding: 0,
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
