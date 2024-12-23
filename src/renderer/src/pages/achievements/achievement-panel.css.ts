import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

import { SPACING_UNIT, vars } from "../../theme.css";

export const panel = style({
  width: "100%",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 3}px`,
  backgroundColor: vars.color.background,
  display: "flex",
  flexDirection: "column",
  alignItems: "start",
  justifyContent: "space-between",
  borderBottom: `solid 1px ${vars.color.border}`,
});

export const content = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
  justifyContent: "center",
});

export const actions = style({
  display: "flex",
  gap: `${SPACING_UNIT}px`,
});

export const downloadDetailsRow = style({
  gap: `${SPACING_UNIT}px`,
  display: "flex",
  color: vars.color.body,
  alignItems: "center",
});

export const downloadsLink = style({
  color: vars.color.body,
  textDecoration: "underline",
});

export const progressBar = recipe({
  base: {
    position: "absolute",
    bottom: "0",
    left: "0",
    width: "100%",
    height: "3px",
    transition: "all ease 0.2s",
    "::-webkit-progress-bar": {
      backgroundColor: "transparent",
    },
    "::-webkit-progress-value": {
      backgroundColor: vars.color.muted,
    },
  },
  variants: {
    disabled: {
      true: {
        opacity: vars.opacity.disabled,
      },
    },
  },
});

export const link = style({
  textAlign: "start",
  color: vars.color.body,
  ":hover": {
    textDecoration: "underline",
    cursor: "pointer",
  },
});
