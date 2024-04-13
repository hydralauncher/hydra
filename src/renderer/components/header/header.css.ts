import type { ComplexStyleRule } from "@vanilla-extract/css";
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { SPACING_UNIT, vars } from "../../theme.css";

export const header = recipe({
  base: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: `${SPACING_UNIT * 2}px`,
    WebkitAppRegion: "drag",
    width: "100%",
    padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 3}px`,
    color: "#c0c1c7",
    borderBottom: `solid 1px ${vars.color.borderColor}`,
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
    border: `solid 1px ${vars.color.borderColor}`,
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

export const searchInput = style({
  backgroundColor: "transparent",
  border: "none",
  width: "100%",
  height: "100%",
  outline: "none",
  color: "#DADBE1",
  cursor: "default",
  fontFamily: "inherit",
  fontSize: vars.size.bodyFontSize,
  textOverflow: "ellipsis",
  ":focus": {
    cursor: "text",
  },
});

export const actionButton = style({
  color: "inherit",
  cursor: "pointer",
  transition: "all ease 0.2s",
  padding: `${SPACING_UNIT}px`,
  ":hover": {
    color: "#DADBE1",
  },
});

export const leftContent = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT * 2}px`,
  height: "100%",
});

export const headerTitle = style({
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: `${SPACING_UNIT * 2}px`,
})

export const backButton = style({
  color: "inherit",
  cursor: "pointer",
});