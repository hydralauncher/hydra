import { vars } from "@renderer/theme.css";
import { style } from "@vanilla-extract/css";

export const contextMenu = style({
  position: "absolute",
  width: "200px",
  backgroundColor: vars.color.darkBackground,
  borderRadius: "6px",
  boxSizing: "border-box",
});

export const contextMenuList = style({
  boxSizing: "border-box",
  padding: "10px",
  margin: "0",
  listStyle: "none",
});

export const contextMenuListItem = style({
  padding: "18px 12px",

  ":hover": {
    cursor: "pointer",
    backgroundColor: vars.color.muted,
  },
});
