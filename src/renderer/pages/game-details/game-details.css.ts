import { globalStyle, style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";

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

export const requirements = style({
  borderLeft: `solid 1px ${vars.color.borderColor};`,
  width: "100%",
  height: "100%",
  "@media": {
    "(min-width: 768px)": {
      maxWidth: "200px",
      width: "200px",
      minWidth: "200px",
    },
    "(min-width: 1024px)": {
      maxWidth: "325px",
      width: "325px",
      minWidth: "325px",
    },
  },
});

export const requirementsHeader = style({
  height: "71px",
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
  border: `solid 1px ${vars.color.borderColor};`,
  borderLeft: "none",
  borderRight: "none",
  borderRadius: "0",
  width: "100%",
});

export const requirementsDetails = style({
  padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 2}px`,
  lineHeight: "22px",
  fontFamily: "'Fira Sans', sans-serif",
  fontSize: "16px",
});

export const description = style({
  userSelect: "text",
  lineHeight: "22px",
  fontFamily: "'Fira Sans', sans-serif",
  fontSize: "16px",
  padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 2}px`,
});

export const descriptionHeader = style({
  width: "100%",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  borderBottom: `solid 1px ${vars.color.borderColor}`,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: vars.color.background,
  height: "72px",
});

export const descriptionHeaderInfo = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  flexDirection: "column",
  fontSize: vars.size.bodyFontSize,
});

globalStyle(".bb_tag", {
  marginTop: `${SPACING_UNIT * 2}px`,
  marginBottom: `${SPACING_UNIT * 2}px`,
});

globalStyle(`${description} img`, {
  borderRadius: 5,
  marginTop: `${SPACING_UNIT}px`,
  marginBottom: `${SPACING_UNIT}px`,
  marginLeft: "auto",
  marginRight: "auto",
  display: "block",
  maxWidth: "100%",
  boxShadow: "0px 0px 15px 0px #000000",
});

globalStyle(`${description} a`, {
  color: vars.color.bodyText,
});

globalStyle(`${requirementsDetails} a`, {
  display: "flex",
  color: vars.color.bodyText,
});
