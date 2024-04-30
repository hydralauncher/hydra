import { createTheme } from "@vanilla-extract/css";

export const SPACING_UNIT = 8;

export const [themeClass, vars] = createTheme({
  color: {
    background: "#1c1c1c",
    darkBackground: "#151515",
    bodyText: "#8e919b",
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  opacity: {
    disabled: "0.5",
    active: "0.7",
  },
  size: {
    bodyFontSize: "14px",
  },
});
