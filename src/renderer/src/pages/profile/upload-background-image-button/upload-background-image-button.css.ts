import { style } from "@vanilla-extract/css";
import { vars } from "../../../theme.css";

export const uploadBackgroundImageButton = style({
  position: "absolute",
  top: 16,
  right: 16,
  borderColor: vars.color.body,
  boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.8)",
  backgroundColor: "rgba(0, 0, 0, 0.1)",
  backdropFilter: "blur(20px)",
});
