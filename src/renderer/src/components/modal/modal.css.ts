import { keyframes, style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { SPACING_UNIT, vars } from "../../theme.css";

export const fadeIn = keyframes({
  "0%": { opacity: 0 },
  "100%": {
    opacity: 1,
  },
});

export const fadeOut = keyframes({
  "0%": { opacity: 1 },
  "100%": {
    opacity: 0,
  },
});

export const modal = recipe({
  base: {
    animationName: fadeIn,
    animationDuration: "0.3s",
    backgroundColor: vars.color.background,
    borderRadius: "4px",
    maxWidth: "600px",
    color: vars.color.body,
    maxHeight: "100%",
    border: `solid 1px ${vars.color.border}`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  variants: {
    closing: {
      true: {
        animationName: fadeOut,
        opacity: 0,
      },
    },
    large: {
      true: {
        width: "800px",
        maxWidth: "800px",
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
  color: vars.color.body,
});
