import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const downloadTitleWrapper = style({
  display: "flex",
  alignItems: "center",
  marginBottom: `${SPACING_UNIT}px`,
  gap: `${SPACING_UNIT}px`,
});

export const downloadTitle = style({
  fontWeight: "bold",
  cursor: "pointer",
  color: vars.color.body,
  textAlign: "left",
  fontSize: "16px",
  display: "block",
  ":hover": {
    textDecoration: "underline",
  },
});

export const downloads = style({
  width: "100%",
  gap: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
  margin: "0",
  padding: "0",
  marginTop: `${SPACING_UNIT}px`,
});

export const downloadCover = style({
  width: "280px",
  minWidth: "280px",
  height: "auto",
  borderRight: `solid 1px ${vars.color.border}`,
  position: "relative",
  zIndex: "1",
});

export const downloadCoverContent = style({
  width: "100%",
  height: "100%",
  padding: `${SPACING_UNIT}px`,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "flex-end",
});

export const downloadCoverBackdrop = style({
  width: "100%",
  height: "100%",
  background: "linear-gradient(0deg, rgba(0, 0, 0, 0.8) 5%, transparent 100%)",
  display: "flex",
  overflow: "hidden",
  zIndex: "1",
});

export const downloadCoverImage = style({
  width: "100%",
  height: "100%",
  position: "absolute",
  zIndex: "-1",
});

export const download = style({
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

export const downloadGroup = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 2}px`,
});
