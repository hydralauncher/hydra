import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";

export const checkboxField = style({
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  cursor: "pointer",
});

export const checkbox = style({
  width: "20px",
  height: "20px",
  borderRadius: "4px",
  backgroundColor: vars.color.darkBackground,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  position: "relative",
  transition: "all ease 0.2s",
  border: `solid 1px ${vars.color.border}`,
  ":hover": {
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
});

export const checkboxInput = style({
  width: "100%",
  height: "100%",
  position: "absolute",
  margin: "0",
  padding: "0",
  opacity: "0",
  cursor: "pointer",
});

export const checkboxLabel = style({
  cursor: "pointer",
});
