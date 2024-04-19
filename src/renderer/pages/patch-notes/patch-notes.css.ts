import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";

export const container = style({
  padding: "24px",
  width: "100%",
  overflow: "scroll",
});

export const content = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
  "@media": {
    "(min-width: 1280px)": {
      width: "50%",
    },
  },
  width: "100%",
  marginLeft: "auto",
  marginRight: "auto",
});

export const releaseHeader = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  justifyContent: "space-between",
  marginBottom: `${SPACING_UNIT * 4}px`,
});

export const releaseTitle = style({
  fontWeight: "bold",
  fontSize: "18px",
});

export const releaseDate = style({
  fontSize: "16px",
});

export const releaseContainer = style({
  padding: `${SPACING_UNIT * 4}px 0`,
  borderBottom: `dashed 1px ${vars.color.borderColor}`,
});

export const accordionItem = style({
  border: "none !important",
});

export const assetsTriggerContainer = style({
  display: "flex",
  width: "100%",
  justifyContent: "space-between",
  alignItems: "center",
});

export const assetsCount = style({
  backgroundColor: vars.color.borderColor,
  borderRadius: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "20px",
  height: "20px",
  fontSize: "12px",

  ":hover": {
    textDecoration: "none",
  },
});

export const assetsContainer = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 1.5}px`,
});

export const assetsItem = style({
  fontSize: "12px",
  color: vars.color.bodyText,
  borderBottom: `solid 1px ${vars.color.borderColor}`,
  textDecoration: "none",
  transition: "all ease 0.2s",
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT * 0.75}px`,
  ":hover": {
    opacity: 0.75,
  },
});

export const assetsItemContainer = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  justifyContent: "space-between",
});

export const separator = style({
  width: "100%",
  height: "1px",
  backgroundColor: vars.color.borderColor,
  marginBottom: `${SPACING_UNIT * 4}px`,
  borderRadius: "12px",
});
