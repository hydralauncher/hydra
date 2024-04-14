import { keyframes, style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { SPACING_UNIT, vars } from "../../theme.css";

export const backdropFadeIn = keyframes({
  "0%": { backdropFilter: "blur(0px)", backgroundColor: "rgba(0, 0, 0, 0.5)" },
  "100%": {
    backdropFilter: "blur(2px)",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
});

export const backdropFadeOut = keyframes({
  "0%": { backdropFilter: "blur(2px)", backgroundColor: "rgba(0, 0, 0, 0.7)" },
  "100%": {
    backdropFilter: "blur(0px)",
    backgroundColor: "rgba(0, 0, 0, 0)",
  },
});

export const modalSlideIn = keyframes({
  "0%": { opacity: 0 },
  "100%": {
    opacity: 1,
  },
});

export const modalSlideOut = keyframes({
  "0%": { opacity: 1 },
  "100%": {
    opacity: 0,
  },
});

export const backdrop = recipe({
  base: {
    animationName: backdropFadeIn,
    animationDuration: "0.4s",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    position: "absolute",
    width: "100%",
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
    top: 0,
    padding: `${SPACING_UNIT * 3}px`,
    backdropFilter: "blur(2px)",
    transition: "all ease 0.2s",
  },
  variants: {
    closing: {
      true: {
        animationName: backdropFadeOut,
        backdropFilter: "blur(0px)",
        backgroundColor: "rgba(0, 0, 0, 0)",
      },
    },
  },
});

export const modal = recipe({
  base: {
    animationName: modalSlideIn,
    animationDuration: "0.3s",
    backgroundColor: vars.color.background,
    borderRadius: "5px",
    maxWidth: "600px",
    color: vars.color.bodyText,
    maxHeight: "100%",
    border: `solid 1px ${vars.color.borderColor}`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  variants: {
    closing: {
      true: {
        animationName: modalSlideOut,
        opacity: 0,
      },
    },
  },
});

export const modalContent = style({
  height: "100%",
  overflow: "auto",
  padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 2}px`,
});

export const modalHeader = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  padding: `${SPACING_UNIT * 2}px`,
  borderBottom: `solid 1px ${vars.color.borderColor}`,
  justifyContent: "space-between",
  alignItems: "flex-start",
});

export const closeModalButton = style({
  cursor: "pointer",
});

export const closeModalButtonIcon = style({
  color: vars.color.bodyText,
});
