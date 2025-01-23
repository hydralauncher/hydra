import { keyframes, style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";
import { recipe } from "@vanilla-extract/recipes";

export const enter = keyframes({
  "0%": {
    opacity: 0,
    transform: "translateY(100%)",
  },
  "100%": {
    opacity: 1,
    transform: "translateY(0)",
  },
});

export const exit = keyframes({
  "0%": {
    opacity: 1,
    transform: "translateY(0)",
  },
  "100%": {
    opacity: 0,
    transform: "translateY(100%)",
  },
});

export const toast = recipe({
  base: {
    animationDuration: "0.15s",
    animationTimingFunction: "ease-in-out",
    maxWidth: "420px",
    position: "absolute",
    backgroundColor: vars.color.background,
    borderRadius: "4px",
    border: `solid 1px ${vars.color.border}`,
    right: "0",
    bottom: "0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    zIndex: vars.zIndex.toast,
  },
  variants: {
    closing: {
      true: {
        animationName: exit,
        transform: "translateY(100%)",
      },
      false: {
        animationName: enter,
        transform: "translateY(0)",
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
  height: "3px",
  "::-webkit-progress-bar": {
    backgroundColor: vars.color.darkBackground,
  },
  "::-webkit-progress-value": {
    backgroundColor: vars.color.muted,
  },
});

export const closeButton = style({
  color: vars.color.body,
  cursor: "pointer",
  transition: "all ease 0.15s",
  ":hover": {
    color: vars.color.muted,
  },
});

export const successIcon = style({
  color: vars.color.success,
});

export const errorIcon = style({
  color: vars.color.danger,
});

export const warningIcon = style({
  color: vars.color.warning,
});
