import { style } from "@vanilla-extract/css";

export const menuContextContainer = style({
  background: "linear-gradient(0deg, rgba(0, 0, 0, 0.7) 50%, transparent 100%)",
  width: "100%",
  height: "100%",
  display: "flex",
  justifyContent: "flex-end",
  flexDirection: "column",
  position: "relative",
});
