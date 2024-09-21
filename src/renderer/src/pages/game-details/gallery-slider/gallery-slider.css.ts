import { recipe } from "@vanilla-extract/recipes";
import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../../theme.css";

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
  flexShrink: "0",
  flexGrow: "0",
  transition: "translate 0.3s ease-in-out",
  borderRadius: "4px",
  alignSelf: "center",
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

export const mediaPreviewButton = recipe({
  base: {
    cursor: "pointer",
    width: "20%",
    display: "block",
    flexShrink: "0",
    flexGrow: "0",
    opacity: "0.3",
    transition: "translate 0.3s ease-in-out, opacity 0.2s ease",
    borderRadius: "4px",
    border: `solid 1px ${vars.color.border}`,
    overflow: "hidden",
    ":hover": {
      opacity: "0.8",
    },
  },
  variants: {
    active: {
      true: {
        opacity: "1",
      },
    },
  },
});

export const mediaPreview = style({
  width: "100%",
  display: "flex",
});

export const gallerySliderButton = recipe({
  base: {
    position: "absolute",
    alignSelf: "center",
    cursor: "pointer",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    transition: "all 0.2s ease-in-out",
    borderRadius: "50%",
    color: vars.color.muted,
    width: "48px",
    height: "48px",
    ":hover": {
      backgroundColor: "rgba(0, 0, 0, 0.6)",
    },
    ":active": {
      transform: "scale(0.95)",
    },
  },
  variants: {
    direction: {
      left: {
        left: "0",
        marginLeft: `${SPACING_UNIT}px`,
        transform: `translateX(${-(48 + SPACING_UNIT)}px)`,
      },
      right: {
        right: "0",
        marginRight: `${SPACING_UNIT}px`,
        transform: `translateX(${48 + SPACING_UNIT}px)`,
      },
    },
    visible: {
      true: {
        transform: "translateX(0)",
        opacity: "1",
      },
      false: {
        opacity: "0",
      },
    },
  },
});
