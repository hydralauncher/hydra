import { style } from "@vanilla-extract/css";

import { SPACING_UNIT, vars } from "../../theme.css";

export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT * 3}px`,
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
  transition: "all ease 0.2s",
  ":hover": {
    opacity: "0.7",
  },
});

export const blockedUsersList = style({
  padding: "0",
  margin: "0",
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: `${SPACING_UNIT}px`,
});
