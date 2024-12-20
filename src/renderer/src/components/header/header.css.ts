import type { ComplexStyleRule } from "@vanilla-extract/css";
import { keyframes, style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

import { SPACING_UNIT, vars } from "../../theme.css";

export const slideIn = keyframes({
  "0%": { transform: "translateX(20px)", opacity: "0" },
  "100%": {
    transform: "translateX(0)",
    opacity: "1",
  },
});

export const slideOut = keyframes({
  "0%": { transform: "translateX(0px)", opacity: "1" },
  "100%": {
    transform: "translateX(20px)",
    opacity: "0",
  },
});

export const header = recipe({
  base: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: `${SPACING_UNIT * 2}px`,
    WebkitAppRegion: "drag",
    width: "100%",
    padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 3}px`,
    color: vars.color.muted,
    borderBottom: `solid 1px ${vars.color.border}`,
    backgroundColor: vars.color.darkBackground,
  } as ComplexStyleRule,
  variants: {
    draggingDisabled: {
      true: {
        WebkitAppRegion: "no-drag",
      } as ComplexStyleRule,
    },
    isWindows: {
      true: {
        WebkitAppRegion: "no-drag",
      } as ComplexStyleRule,
    },
  },
});

export const search = recipe({
  base: {
    backgroundColor: vars.color.background,
    display: "inline-flex",
    transition: "all ease 0.2s",
    width: "200px",
    alignItems: "center",
    borderRadius: "8px",
    border: `solid 1px ${vars.color.border}`,
    height: "40px",
    WebkitAppRegion: "no-drag",
  } as ComplexStyleRule,
  variants: {
    focused: {
      true: {
        width: "250px",
        borderColor: "#DADBE1",
      },
      false: {
        ":hover": {
          borderColor: "rgba(255, 255, 255, 0.5)",
        },
      },
    },
  },
});

export const searchButton = style({
  WebkitAppRegion: "no-drag",
} as ComplexStyleRule);

export const section = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT * 2}px`,
  height: "100%",
  overflow: "hidden",
});

export const backButton = recipe({
  base: {
    color: vars.color.body,
    cursor: "pointer",
    WebkitAppRegion: "no-drag",
    position: "absolute",
    transition: "transform ease 0.2s",
    animationDuration: "0.2s",
    width: "16px",
    height: "16px",
    display: "flex",
    alignItems: "center",
  } as ComplexStyleRule,
  variants: {
    enabled: {
      true: {
        animationName: slideIn,
      },
      false: {
        opacity: "0",
        pointerEvents: "none",
        animationName: slideOut,
      },
    },
  },
});

export const title = recipe({
  base: {
    transition: "all ease 0.2s",
    overflow: "hidden",
    textOverflow: "ellipsis",
    width: "100%",
  },
  variants: {
    hasBackButton: {
      true: {
        transform: "translateX(28px)",
        width: "calc(100% - 28px)",
      },
    },
  },
});

export const subheader = style({
  borderBottom: `solid 1px ${vars.color.border}`,
  padding: `${SPACING_UNIT / 2}px ${SPACING_UNIT * 3}px`,
});

export const newVersionButton = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: `${SPACING_UNIT}px`,
  color: vars.color.body,
  fontSize: "12px",
  ":hover": {
    textDecoration: "underline",
    cursor: "pointer",
  },
});

export const newVersionLink = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  color: "#8e919b",
  fontSize: "12px",
});

export const newVersionIcon = style({
  color: vars.color.success,
});
