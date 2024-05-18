import { globalStyle, style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

export const contentSidebar = style({
  borderLeft: `solid 1px ${vars.color.border};`,
  width: "100%",
  height: "100%",
  "@media": {
    "(min-width: 768px)": {
      width: "100%",
      maxWidth: "200px",
    },
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
  fontFamily: "'Fira Sans', sans-serif",
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
  borderRadius: "8px",
  padding: `8px 16px`,
  border: `solid 1px ${vars.color.border}`,
});

export const howLongToBeatCategoryLabel = style({
  color: vars.color.muted,
});

export const howLongToBeatCategorySkeleton = style({
  border: `solid 1px ${vars.color.border}`,
  borderRadius: "8px",
  height: "76px",
});

export const steamUserRatingContainer = style({
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  flexDirection: "column",
  gap: "5px",
  marginBottom: "10px",
});

export const userRatingStars = style({
  listStyle: "none",
  display: "flex",
  gap: "10px",
  margin: "10px 0 5px",
});

export const steamUserRatingBarContainer = style({
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  flexDirection: "column",
  gap: "5px",
  margin: "20px 0 10px",
});

export const bar = style({
  width: "90%",
  height: "8px",
  backgroundColor: vars.color.border,
  borderRadius: "10px",
  overflow: "hidden",
});

export const barfilling = style({
  height: "8px",
  backgroundColor: "#7f7f7f",
  borderRadius: "10px",
  overflow: "hidden",
});

export const rating = style({
  display: "flex",
  justifyContent: "space-between",
  fontFamily: "'Fira Sans', sans-serif",
  fontSize: "16px",
  width: "90%",
  padding: "5px",
});

globalStyle(`${requirementsDetails} a`, {
  display: "flex",
  color: vars.color.bodyText,
});
