import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";

export const slideIn = keyframes({
  "0%": { transform: `translateY(${40 + 16}px)` },
  "100%": { transform: "translateY(0)" },
});

export const hero = style({
  width: "100%",
  height: "300px",
  minHeight: "300px",
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

export const heroContent = style({
  padding: `${SPACING_UNIT * 2}px`,
  height: "100%",
  width: "100%",
  display: "flex",
});

export const heroBackdrop = style({
  width: "100%",
  height: "100%",
  background: "linear-gradient(0deg, rgba(0, 0, 0, 0.3) 60%, transparent 100%)",
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
});

export const heroImage = style({
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "top",
  transition: "all ease 0.2s",
  "@media": {
    "(min-width: 1250px)": {
      objectPosition: "center",
    },
  },
});

export const heroImageSkeleton = style({
  height: "300px",
  "@media": {
    "(min-width: 1250px)": {
      height: "350px",
    },
  },
});

export const container = style({
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
});

export const descriptionContainer = style({
  display: "flex",
  width: "100%",
  flex: "1",
});

export const descriptionContent = style({
  width: "100%",
  height: "100%",
});

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

export const description = style({
  userSelect: "text",
  lineHeight: "22px",
  fontFamily: "'Fira Sans', sans-serif",
  fontSize: "16px",
  padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 2}px`,
  "@media": {
    "(min-width: 1280px)": {
      width: "60%",
    },
  },
  width: "100%",
  marginLeft: "auto",
  marginRight: "auto",
});

export const descriptionSkeleton = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
  padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 2}px`,
  width: "100%",
  "@media": {
    "(min-width: 1280px)": {
      width: "60%",
      lineHeight: "22px",
    },
  },
  marginLeft: "auto",
  marginRight: "auto",
});

export const descriptionHeader = style({
  width: "100%",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: vars.color.background,
  borderBottom: `solid 1px ${vars.color.border}`,
  height: "72px",
});

export const descriptionHeaderInfo = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  flexDirection: "column",
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

export const randomizerButton = style({
  animationName: slideIn,
  animationDuration: "0.2s",
  position: "fixed",
  /* Bottom panel height + spacing */
  bottom: `${26 + SPACING_UNIT * 2}px`,
  /* Scroll bar + spacing */
  right: `${9 + SPACING_UNIT * 2}px`,
  boxShadow: "rgba(255, 255, 255, 0.1) 0px 0px 10px 3px",
  border: `solid 2px ${vars.color.border}`,
  backgroundColor: vars.color.background,
  ":hover": {
    backgroundColor: vars.color.background,
    boxShadow: "rgba(255, 255, 255, 0.1) 0px 0px 15px 5px",
    opacity: "1",
  },
  ":active": {
    transform: "scale(0.98)",
  },
});

globalStyle(".bb_tag", {
  marginTop: `${SPACING_UNIT * 2}px`,
  marginBottom: `${SPACING_UNIT * 2}px`,
});

globalStyle(`${description} img`, {
  borderRadius: "5px",
  marginTop: `${SPACING_UNIT}px`,
  marginBottom: `${SPACING_UNIT * 3}px`,
  display: "block",
  width: "100%",
  height: "auto",
  objectFit: "cover",
});

globalStyle(`${description} a`, {
  color: vars.color.bodyText,
});

globalStyle(`${requirementsDetails} a`, {
  display: "flex",
  color: vars.color.bodyText,
});
