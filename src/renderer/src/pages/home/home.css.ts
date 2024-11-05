import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";

export const homeHeader = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  justifyContent: "space-between",
  alignItems: "center",
});

export const content = style({
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 3}px`,
  padding: `${SPACING_UNIT * 3}px`,
  flex: "1",
  overflowY: "auto",
});

export const cards = style({
  display: "grid",
  gridTemplateColumns: "repeat(1, 1fr)",
  gap: `${SPACING_UNIT * 2}px`,
  transition: "all ease 0.2s",
  "@media": {
    "(min-width: 768px)": {
      gridTemplateColumns: "repeat(2, 1fr)",
    },
    "(min-width: 1250px)": {
      gridTemplateColumns: "repeat(3, 1fr)",
    },
    "(min-width: 1600px)": {
      gridTemplateColumns: "repeat(4, 1fr)",
    },
  },
});

export const cardSkeleton = style({
  width: "100%",
  height: "180px",
  boxShadow: "0px 0px 15px 0px #000000",
  overflow: "hidden",
  borderRadius: "4px",
  transition: "all ease 0.2s",
  zIndex: "1",
  ":active": {
    opacity: vars.opacity.active,
  },
});

export const noResults = style({
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  gap: "16px",
  gridColumn: "1 / -1",
});

export const buttonsList = style({
  display: "flex",
  listStyle: "none",
  margin: "0",
  padding: "0",
  gap: `${SPACING_UNIT}px`,
});

export const flameIcon = style({
  width: "30px",
  top: "-10px",
  left: "-5px",
  position: "absolute",
});
