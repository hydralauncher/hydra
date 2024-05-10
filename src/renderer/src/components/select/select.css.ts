import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

export const select = recipe({
  base: {
    display: "inline-flex",
    transition: "all ease 0.2s",
    width: "fit-content",
    alignItems: "center",
    borderRadius: "8px",
    border: `solid 1px ${vars.color.borderColor}`,
    height: "40px",
    minHeight: "40px",
  },
  variants: {
    focused: {
      true: {
        borderColor: "#DADBE1",
      },
      false: {
        ":hover": {
          borderColor: "rgba(255, 255, 255, 0.5)",
        },
      },
    },
    theme: {
      primary: {
        backgroundColor: vars.color.darkBackground,
      },
      dark: {
        backgroundColor: vars.color.background,
      },
    },
  },
});

export const option = style({
  backgroundColor: "transparent",
  border: "none",
  width: "fit-content",
  height: "100%",
  outline: "none",
  color: "#DADBE1",
  cursor: "default",
  fontFamily: "inherit",
  fontSize: vars.size.bodyFontSize,
  textOverflow: "ellipsis",
  padding: `${SPACING_UNIT}px`,
  ":focus": {
    cursor: "text",
  },
});

export const label = style({
  marginBottom: `${SPACING_UNIT}px`,
  display: "block",
  color: vars.color.bodyText,
});
