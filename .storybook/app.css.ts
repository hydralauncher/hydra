import { createContainer, globalStyle } from "@vanilla-extract/css";
import { vars } from "../src/renderer/src/theme.css";

export const appContainer = createContainer();

globalStyle("*", {
  boxSizing: "border-box",
});

globalStyle("::-webkit-scrollbar", {
  width: "9px",
  backgroundColor: vars.color.darkBackground,
});

globalStyle("::-webkit-scrollbar-track", {
  backgroundColor: "rgba(255, 255, 255, 0.03)",
});

globalStyle("::-webkit-scrollbar-thumb", {
  backgroundColor: "rgba(255, 255, 255, 0.08)",
  borderRadius: "24px",
});

globalStyle("::-webkit-scrollbar-thumb:hover", {
  backgroundColor: "rgba(255, 255, 255, 0.16)",
});

globalStyle("html, body, #root, main", {
  height: "100%",
});

globalStyle("body", {
  userSelect: "none",
  fontFamily: "Noto Sans, sans-serif",
  fontSize: vars.size.body,
  color: vars.color.body,
  margin: "0",
});

globalStyle("button", {
  padding: "0",
  backgroundColor: "transparent",
  border: "none",
  fontFamily: "inherit",
});

globalStyle("h1, h2, h3, h4, h5, h6, p", {
  margin: 0,
});

globalStyle("p", {
  lineHeight: "20px",
});

globalStyle("#root, main", {
  display: "flex",
});

globalStyle("#root", {
  flexDirection: "column",
});

globalStyle(
  "input::-webkit-outer-spin-button, input::-webkit-inner-spin-button",
  {
    WebkitAppearance: "none",
    margin: "0",
  }
);

globalStyle("label", {
  fontSize: vars.size.body,
});

globalStyle("input[type=number]", {
  MozAppearance: "textfield",
});

globalStyle("img", {
  WebkitUserDrag: "none",
} as Record<string, string>);

globalStyle("progress[value]", {
  WebkitAppearance: "none",
});
