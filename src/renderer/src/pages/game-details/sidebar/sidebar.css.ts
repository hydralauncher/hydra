import { globalStyle, style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

export const contentSidebar = style({
  borderLeft: `solid 1px ${vars.color.border};`,
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

export const contentSidebarTitle = style({
  height: "72px",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "center",
  backgroundColor: vars.color.background,
  justifyContent: "space-between",
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
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
});

export const howLongToBeatCategory = style({
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  backgroundColor: vars.color.background,
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
