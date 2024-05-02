import { keyframes, style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { SPACING_UNIT, vars } from "../../theme.css";

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

export const modal = recipe({
  base: {
    animationName: modalSlideIn,
    animationDuration: "0.3s",
    backgroundColor: vars.color.background,
    borderRadius: "5px",
    maxWidth: "600px",
    color: vars.color.bodyText,
    maxHeight: "100%",
    border: `solid 1px ${vars.color.border}`,
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
  borderBottom: `solid 1px ${vars.color.border}`,
  justifyContent: "space-between",
  alignItems: "center",
});

export const closeModalButton = style({
  cursor: "pointer",
  transition: "all ease 0.2s",
  alignSelf: "flex-start",
  ":hover": {
    opacity: "0.75",
  },
});

export const closeModalButtonIcon = style({
  color: vars.color.bodyText,
});
