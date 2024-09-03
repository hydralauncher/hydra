import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

import { SPACING_UNIT, vars } from "../../theme.css";

export const select = recipe({
  base: {
    display: "inline-flex",
    transition: "all ease 0.2s",
    width: "100%",
    alignItems: "center",
    borderRadius: "8px",
    border: `1px solid ${vars.color.border}`,
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
  backgroundColor: vars.color.darkBackground,
  borderRight: "4px solid",
  borderColor: "transparent",
  borderRadius: "8px",
  width: "fit-content",
  height: "100%",
  outline: "none",
  color: "#DADBE1",
  cursor: "default",
  fontFamily: "inherit",
  fontSize: vars.size.body,
  textOverflow: "ellipsis",
  padding: `${SPACING_UNIT}px`,
});

export const label = style({
  marginBottom: `${SPACING_UNIT}px`,
  display: "block",
  color: vars.color.body,
});
