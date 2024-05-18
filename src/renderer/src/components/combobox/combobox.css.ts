import { SPACING_UNIT, vars } from "../../theme.css";
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

export const comboboxContainer = style({
  flex: "1",
  gap: `${SPACING_UNIT}px`,
  display: "flex",
  flexDirection: "column",
});

export const combobox = recipe({
  base: {
    transition: "all ease 0.2s",
    width: "100%",
    alignItems: "center",
    borderRadius: "8px",
    border: `solid 1px ${vars.color.border}`,
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

export const comboboxOptions = recipe({
  variants: {
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
