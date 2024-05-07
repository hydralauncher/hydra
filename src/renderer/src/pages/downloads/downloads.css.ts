import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

export const downloadTitleWrapper = style({
  display: "flex",
  alignItems: "center",
  marginBottom: `${SPACING_UNIT}px`,
  gap: `${SPACING_UNIT}px`,
});

export const downloadTitle = style({
  fontWeight: "bold",
  cursor: "pointer",
  color: vars.color.bodyText,
  textAlign: "left",
  fontSize: "16px",
  display: "block",
  ":hover": {
    textDecoration: "underline",
  },
});

export const downloaderName = style({
  color: "#c0c1c7",
  fontSize: "10px",
  padding: `${SPACING_UNIT / 2}px ${SPACING_UNIT}px`,
  border: "solid 1px #c0c1c7",
  borderRadius: "4px",
  display: "flex",
  alignItems: "center",
});

export const downloads = style({
  width: "100%",
  gap: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
  margin: "0",
  padding: "0",
  marginTop: `${SPACING_UNIT * 3}px`,
});

export const downloadCover = style({
  width: "280px",
  minWidth: "280px",
  height: "auto",
  objectFit: "cover",
  objectPosition: "center",
  borderRight: `solid 1px ${vars.color.border}`,
});

export const download = recipe({
  base: {
    width: "100%",
    backgroundColor: vars.color.background,
    display: "flex",
    borderRadius: "8px",
    border: `solid 1px ${vars.color.border}`,
    overflow: "hidden",
    boxShadow: "0px 0px 15px 0px #000000",
    transition: "all ease 0.2s",
    height: "140px",
    minHeight: "140px",
    maxHeight: "140px",
  },
  variants: {
    cancelled: {
      true: {
        opacity: vars.opacity.disabled,
        ":hover": {
          opacity: "1",
        },
      },
    },
  },
});

export const downloadDetails = style({
  display: "flex",
  flexDirection: "column",
  flex: "1",
  justifyContent: "center",
  gap: `${SPACING_UNIT / 2}px`,
  fontSize: "14px",
});

export const downloadRightContent = style({
  display: "flex",
  padding: `${SPACING_UNIT * 2}px`,
  flex: "1",
  gap: `${SPACING_UNIT}px`,
});

export const downloadActions = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
});

export const downloadsContainer = style({
  display: "flex",
  padding: `${SPACING_UNIT * 3}px`,
  flexDirection: "column",
  width: "100%",
});
