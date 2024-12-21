import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

import { SPACING_UNIT, vars } from "../../theme.css";

export const panel = style({
  width: "100%",
  height: "72px",
  minHeight: "72px",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 3}px`,
  backgroundColor: vars.color.background,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  transition: "all ease 0.2s",
  borderBottom: `solid 1px ${vars.color.border}`,
  overflow: "hidden",
});

export const content = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
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
