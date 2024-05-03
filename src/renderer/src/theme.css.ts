import { createTheme } from "@vanilla-extract/css";
import themes from "./themes/themes.json"

const theme = themes[0]

export const SPACING_UNIT = 8;

export const [themeClass, vars] = createTheme({
  color: {
    background: theme.scheme.background,
    darkBackground: theme.scheme.darkBackground,
    muted: theme.scheme.muted,
    bodyText: theme.scheme.font,
    border: theme.scheme.border,
  },
  opacity: {
    disabled: "0.5",
    active: "0.7",
  },
  size: {
    bodyFontSize: "14px",
  },
});
