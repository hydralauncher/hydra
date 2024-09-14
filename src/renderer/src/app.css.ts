import {
  ComplexStyleRule,
  createContainer,
  globalStyle,
  style,
} from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "./theme.css";

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

globalStyle("html, body, #root, main", {
  height: "100%",
});

globalStyle("body", {
  overflow: "hidden",
  userSelect: "none",
  fontFamily: "Noto Sans, sans-serif",
  fontSize: vars.size.body,
  background: vars.color.background,
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

globalStyle("main", {
  overflow: "hidden",
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

export const container = style({
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  containerName: appContainer,
  containerType: "inline-size",
});

export const content = style({
  overflowY: "auto",
  alignItems: "center",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  height: "100%",
  background: `linear-gradient(0deg, ${vars.color.darkBackground} 50%, ${vars.color.background} 100%)`,
});

export const titleBar = style({
  display: "flex",
  width: "100%",
  height: "35px",
  minHeight: "35px",
  backgroundColor: vars.color.darkBackground,
  alignItems: "center",
  padding: `0 ${SPACING_UNIT * 2}px`,
  WebkitAppRegion: "drag",
  zIndex: "4",
  borderBottom: `1px solid ${vars.color.border}`,
} as ComplexStyleRule);
