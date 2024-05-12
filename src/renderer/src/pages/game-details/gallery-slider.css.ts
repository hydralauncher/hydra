import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";

export const gallerySliderContainer = style({
  padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 2}px`,
  width: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
});

export const gallerySliderMedia = style({
  width: "100%",
  height: "100%",
  display: "block",
  flexShrink: 0,
  flexGrow: "0",
  transition: "translate 0.3s ease-in-out",
  borderRadius: "4px",
});

export const gallerySliderAnimationContainer = style({
  width: "100%",
  height: "100%",
  display: "flex",
  position: "relative",
  overflow: "hidden",
  "@media": {
    "(min-width: 1280px)": {
      width: "60%",
    },
  },
});

export const gallerySliderPreview = style({
  width: "100%",
  padding: `${SPACING_UNIT}px 0`,
  height: "100%",
  display: "flex",
  position: "relative",
  overflowX: "auto",
  overflowY: "hidden",
  gap: `${SPACING_UNIT / 2}px`,
  "@media": {
    "(min-width: 1280px)": {
      width: "60%",
    },
  },
  "::-webkit-scrollbar-thumb": {
    width: "20%",
  },
  "::-webkit-scrollbar": {
    height: "10px",
  },
});

export const gallerySliderMediaPreview = style({
  cursor: "pointer",
  width: "20%",
  height: "20%",
  display: "block",
  flexShrink: 0,
  flexGrow: 0,
  opacity: 0.3,
  transition: "translate 0.3s ease-in-out, opacity 0.2s ease",
  borderRadius: "4px",
  border: `solid 1px ${vars.color.border}`,
  ":hover": {
    opacity: "1",
  },
});

export const gallerySliderMediaPreviewActive = style({
  opacity: 1,
});

export const gallerySliderButton = style({
  all: "unset",
  display: "block",
  position: "absolute",
  top: 0,
  bottom: 0,
  padding: "1rem",
  cursor: "pointer",
  transition: "background-color 100ms ease-in-out",
  ":hover": {
    backgroundColor: "rgb(0, 0, 0, 0.2)",
  },
});

export const gallerySliderIcons = style({
  fill: vars.color.muted,
  width: "2rem",
  height: "2rem",
});
