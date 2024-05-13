import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";

export const card = style({
  width: "100%",
  height: "180px",
  boxShadow: "0px 0px 15px 0px #000000",
  overflow: "hidden",
  borderRadius: "4px",
  transition: "all ease 0.2s",
  border: `solid 1px ${vars.color.border}`,
  cursor: "pointer",
  zIndex: "1",
  ":active": {
    opacity: vars.opacity.active,
  },
});

export const backdrop = style({
  background: "linear-gradient(0deg, rgba(0, 0, 0, 0.7) 50%, transparent 100%)",
  width: "100%",
  height: "100%",
  display: "flex",
  justifyContent: "flex-end",
  flexDirection: "column",
  position: "relative",
});

export const cover = style({
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "center",
  position: "absolute",
  zIndex: "-1",
  transition: "all ease 0.2s",
  selectors: {
    [`${card}:hover &`]: {
      transform: "scale(1.05)",
    },
  },
});

export const content = style({
  color: "#DADBE1",
  padding: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "flex-start",
  gap: `${SPACING_UNIT}px`,
  flexDirection: "column",
  transition: "all ease 0.2s",
  transform: "translateY(24px)",
  selectors: {
    [`${card}:hover &`]: {
      transform: "translateY(0px)",
    },
  },
});

export const title = style({
  fontSize: "16px",
  fontWeight: "bold",
  textAlign: "left",
});

export const downloadOptions = style({
  display: "flex",
  margin: "0",
  padding: "0",
  gap: `${SPACING_UNIT}px`,
  flexWrap: "wrap",
});

export const downloadOption = style({
  color: "#c0c1c7",
  fontSize: "10px",
  padding: `${SPACING_UNIT / 2}px ${SPACING_UNIT}px`,
  border: "solid 1px #c0c1c7",
  borderRadius: "4px",
  display: "flex",
  alignItems: "center",
});

export const specifics = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  justifyContent: "center",
});

export const specificsItem = style({
  gap: `${SPACING_UNIT}px`,
  display: "flex",
  color: vars.color.muted,
  fontSize: "12px",
  alignItems: "flex-end",
});

export const titleContainer = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  color: vars.color.muted,
});

export const shopIcon = style({
  width: "20px",
  height: "20px",
  minWidth: "20px",
});

export const noDownloadsLabel = style({
  color: vars.color.bodyText,
  fontWeight: "bold",
});
