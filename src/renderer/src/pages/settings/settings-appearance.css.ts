import { style } from "@vanilla-extract/css";

export const themeContainer = style({
  padding: "0px",
  display: "grid",
  gap: "25px",
  flexWrap: "wrap",
  listStyleType: "none",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(min(100%/2, max(200px, 100%/4)), 1fr))",
});

export const themeItem = style({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  gap: "10px",
  cursor: "pointer",
});

export const themeInfo = style({
  display: "flex",
  gap: "25px",
  flexWrap: "wrap",
});

export const themePreview = style({
  height: "200px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
});

export const themeScheme = style({
  display: "flex",
  justifyContent: "start",
  alignItems: "center",
  padding: "0px",
});

export const themeColor = style({
  width: "10px",
  height: "10px",
  display: "block",
  listStyle: "none",
});
