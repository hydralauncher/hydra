import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";

export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});

export const blockedUserAvatar = style({
  width: "32px",
  height: "32px",
  borderRadius: "4px",
});

export const blockedUser = style({
  display: "flex",
  minWidth: "240px",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: vars.color.darkBackground,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "4px",
  padding: `${SPACING_UNIT}px`,
});

export const unblockButton = style({
  color: vars.color.muted,
  cursor: "pointer",
});
