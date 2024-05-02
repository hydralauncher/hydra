import { vars } from "../../../theme.css";
import { keyframes, style } from "@vanilla-extract/css";

export const slideIn = keyframes({
  "0%": { transform: "translateY(0)" },
  "40%": { transform: "translateY(0)" },
  "70%": { transform: "translateY(-100%)" },
  "100%": { transform: "translateY(-100%)" },
});

export const windowContainer = style({
  width: "250px",
  height: "150px",
  alignSelf: "center",
  borderRadius: "2px",
  overflow: "hidden",
  border: `solid 1px ${vars.color.border}`,
});

export const windowContent = style({
  backgroundColor: vars.color.muted,
  height: "90%",
  animationName: slideIn,
  animationDuration: "3s",
  animationIterationCount: "infinite",
  animationTimingFunction: "ease-out",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#1c1c1c",
});
