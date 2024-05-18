import { style } from "@vanilla-extract/css";
import { vars, SPACING_UNIT } from "../../../theme.css";

export const contentSidebarTitle = style({
  height: "72px",
  padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "center",
  backgroundColor: vars.color.background,
});

export const cards = style({
  transition: "all ease 0.2s",
  display: "flex",
  flexDirection: "column",
  padding: `${SPACING_UNIT * 2}px`,
  gap: `${SPACING_UNIT * 2}px`,
});
