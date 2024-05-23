import { keyframes, style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";
import { recipe } from "@vanilla-extract/recipes";

const TOAST_HEIGHT = 55;

export const slideIn = keyframes({
  "0%": { transform: `translateY(${TOAST_HEIGHT + SPACING_UNIT * 2}px)` },
  "100%": { transform: "translateY(0)" },
});

export const slideOut = keyframes({
  "0%": { transform: `translateY(0)` },
  "100%": { transform: `translateY(${TOAST_HEIGHT + SPACING_UNIT * 2}px)` },
});

export const toast = recipe({
  base: {
    animationDuration: "0.2s",
    animationTimingFunction: "ease-in-out",
    height: TOAST_HEIGHT,
    position: "fixed",
    backgroundColor: vars.color.background,
    borderRadius: "4px",
    border: `solid 1px ${vars.color.border}`,
    left: "50%",
    /* Bottom panel height + spacing */
    bottom: `${26 + SPACING_UNIT * 2}px`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  variants: {
    closing: {
      true: {
        animationName: slideOut,
        transform: `translateY(${TOAST_HEIGHT + SPACING_UNIT * 2}px)`,
      },
      false: {
        animationName: slideIn,
        transform: `translateY(0)`,
      },
    },
  },
});

export const toastContent = style({
  display: "flex",
  gap: `${SPACING_UNIT * 2}px`,
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  justifyContent: "center",
  alignItems: "center",
});

export const progress = style({
  width: "100%",
  height: "5px",
  "::-webkit-progress-bar": {
    backgroundColor: vars.color.darkBackground,
  },
  "::-webkit-progress-value": {
    backgroundColor: vars.color.muted,
  },
});

export const closeButton = style({
  color: vars.color.bodyText,
  cursor: "pointer",
  padding: "0",
  margin: "0",
});

export const successIcon = style({
  color: vars.color.success,
});

export const errorIcon = style({
  color: vars.color.danger,
});
