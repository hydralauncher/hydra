import { recipe } from "@vanilla-extract/recipes";
import { vars } from "../../theme.css";
import { keyframes, style } from "@vanilla-extract/css";

const animationIn = keyframes({
  "0%": { transform: `translateY(-240px)` },
  "100%": { transform: "translateY(0)" },
});

const animationOut = keyframes({
  "0%": { transform: `translateY(0)` },
  "100%": { transform: "translateY(-240px)" },
});

export const container = recipe({
  base: {
    marginTop: "24px",
    marginLeft: "24px",
    animationDuration: "1.0s",
    height: "60px",
    display: "flex",
  },
  variants: {
    closing: {
      true: {
        animationName: animationOut,
        transform: "translateY(-240px)",
      },
      false: {
        animationName: animationIn,
        transform: "translateY(0)",
      },
    },
  },
});

export const content = style({
  display: "flex",
  flexDirection: "row",
  gap: "8px",
  alignItems: "center",
  background: vars.color.background,
  paddingRight: "8px",
});
