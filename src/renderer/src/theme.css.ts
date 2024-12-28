import { createGlobalTheme } from "@vanilla-extract/css";

export const SPACING_UNIT = 8;

export const vars = createGlobalTheme(":root", {
  color: {
    background: "#1c1c1c",
    darkBackground: "#151515",
    muted: "#c0c1c7",
    body: "#8e919b",
    border: "rgba(255, 255, 255, 0.15)",
    success: "#1c9749",
    danger: "#e11d48",
    warning: "#ffc107",
  },
  opacity: {
    disabled: "0.5",
    active: "0.7",
  },
  size: {
    body: "14px",
    small: "12px",
  },
  zIndex: {
    toast: "5",
    bottomPanel: "3",
    titleBar: "4",
    backdrop: "4",
  },
});
