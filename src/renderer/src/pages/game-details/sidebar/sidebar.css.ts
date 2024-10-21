import { globalStyle, style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";
import { recipe } from "@vanilla-extract/recipes";

export const contentSidebar = style({
  borderLeft: `solid 1px ${vars.color.border}`,
  backgroundColor: vars.color.darkBackground,
  width: "100%",
  height: "100%",
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

export const requirementButtonContainer = style({
  width: "100%",
  display: "flex",
});

export const requirementButton = style({
  border: `solid 1px ${vars.color.border};`,
  borderLeft: "none",
  borderRight: "none",
  borderRadius: "0",
  width: "100%",
});

export const requirementsDetails = style({
  padding: `${SPACING_UNIT * 2}px`,
  lineHeight: "22px",
  fontSize: "16px",
});

export const requirementsDetailsSkeleton = style({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: `${SPACING_UNIT * 2}px`,
  fontSize: "16px",
});

export const howLongToBeatCategoriesList = style({
  margin: "0",
  padding: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
  gap: "16px",
});

export const howLongToBeatCategory = style({
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  background:
    "linear-gradient(90deg, transparent 20%, rgb(255 255 255 / 2%) 100%)",
  borderRadius: "4px",
  padding: `8px 16px`,
  border: `solid 1px ${vars.color.border}`,
});

export const howLongToBeatCategoryLabel = style({
  color: vars.color.muted,
});

export const howLongToBeatCategorySkeleton = style({
  border: `solid 1px ${vars.color.border}`,
  borderRadius: "4px",
  height: "76px",
});

export const statsSection = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  padding: `${SPACING_UNIT * 2}px`,
  justifyContent: "space-between",
  transition: "max-height ease 0.5s",
  overflow: "hidden",
  "@media": {
    "(min-width: 1024px)": {
      flexDirection: "column",
    },
    "(min-width: 1280px)": {
      flexDirection: "row",
    },
  },
});

export const statsCategoryTitle = style({
  fontSize: "14px",
  fontWeight: "bold",
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
});

export const statsCategory = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT / 2}px`,
});

globalStyle(`${requirementsDetails} a`, {
  display: "flex",
  color: vars.color.body,
});

export const list = style({
  listStyle: "none",
  margin: "0",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
  padding: `${SPACING_UNIT * 2}px`,
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
