import { style } from "@vanilla-extract/css";
import { SPACING_UNIT, vars } from "../../theme.css";
import { recipe } from "@vanilla-extract/recipes";

export const downloadSources = style({
  padding: "0",
  margin: "0",
  gap: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
});

export const downloadSourceItem = recipe({
  base: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: vars.color.darkBackground,
    borderRadius: "8px",
    padding: `${SPACING_UNIT * 2}px`,
    gap: `${SPACING_UNIT}px`,
    border: `solid 1px ${vars.color.border}`,
    transition: "all ease 0.2s",
  },
  variants: {
    isSyncing: {
      true: {
        opacity: vars.opacity.disabled,
      },
    },
  },
});

export const downloadSourceItemHeader = style({
  marginBottom: `${SPACING_UNIT}px`,
  display: "flex",
  flexDirection: "column",
  gap: `${SPACING_UNIT}px`,
});

export const downloadSourcesHeader = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
});

export const separator = style({
  height: "100%",
  width: "1px",
  backgroundColor: vars.color.border,
  margin: `${SPACING_UNIT}px 0`,
});
