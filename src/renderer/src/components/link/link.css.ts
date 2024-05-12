import { style } from "@vanilla-extract/css";

export const link = style({
  textDecoration: "none",
  color: "#C0C1C7",
  ":hover": {
    textDecoration: "underline",
  },
});
