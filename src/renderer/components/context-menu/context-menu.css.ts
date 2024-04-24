import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { style } from "@vanilla-extract/css";

// animations && data-state props are missing

export const contextMenuSubTrigger = style({
  display: "flex",
  cursor: "default",
  userSelect: "none",
  alignItems: "center",
  borderRadius: `${SPACING_UNIT / 2}px`,
  padding: `${SPACING_UNIT * 0.75}px ${SPACING_UNIT}px`,
  fontSize: `${vars.size.bodyFontSize}px`,
  outline: "none",

  ":focus": {
    backgroundColor: `${vars.color.darkBackground}`,
    color: `${vars.color.bodyText}`,
  },

  // selectors: {
  //   "[data-state=open]": {
  //     backgroundColor: "var(--accent)",
  //     color: "var(--accent-foreground)",
  //   },
  // },
});

export const contextMenuSubTriggerInset = style({
  paddingLeft: `${SPACING_UNIT * 4}px`,
});

export const contextMenuSubTriggerIcon = style({
  marginLeft: "auto",
  height: "2rem",
  width: "2rem",
});

export const contextMenuSubContent = style({
  zIndex: 50,
  minWidth: "8rem",
  overflow: "hidden",
  borderRadius: `${SPACING_UNIT * 0.5}px`,
  border: `1px solid ${vars.color.borderColor}`,
  backgroundColor: `${vars.color.darkBackground}`,
  padding: `${SPACING_UNIT}px`,
  color: `${vars.color.bodyText}`,
  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.08)",
});

export const contextMenuContent = style({
  zIndex: 50,
  minWidth: "8rem",
  overflow: "hidden",
  borderRadius: `${SPACING_UNIT / 2}px`,
  border: `1px solid ${vars.color.borderColor}`,
  backgroundColor: `${vars.color.darkBackground}`,
  padding: `${SPACING_UNIT * 0.75}px ${SPACING_UNIT / 4}px`,
  color: `${vars.color.bodyText}`,
  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.08)",
});

export const contextMenuItem = style({
  position: "relative",
  display: "flex",
  cursor: "default",
  userSelect: "none",
  alignItems: "center",
  borderRadius: `${SPACING_UNIT / 2}px`,
  padding: `${SPACING_UNIT * 0.75}px ${SPACING_UNIT * 2}px`,
  fontSize: `12px`,
  outline: "none",

  ":hover": {
    backgroundColor: `${vars.color.borderColor}`,
    transition: "all ease 0.15s",
    color: `${vars.color.bodyText}`,
    cursor: "pointer",
  },

  // selectors: {
  //   '[data-disabled="true"]': {
  //     pointerEvents: "none",
  //     opacity: 0.5,
  //   },
  // },
});

export const contextMenuItemInset = style({
  paddingLeft: "4rem",
});

export const contextMenuCheckboxItem = style({
  position: "relative",
  display: "flex",
  cursor: "default",
  userSelect: "none",
  alignItems: "center",
  borderRadius: `${SPACING_UNIT / 2}px`,
  padding: `${SPACING_UNIT * 1.5}px ${SPACING_UNIT * 2}px ${SPACING_UNIT * 1.5}px ${SPACING_UNIT * 8}px`,
  fontSize: `12px`,
  outline: "none",

  ":focus": {
    backgroundColor: `${vars.color.darkBackground}`,
    color: `${vars.color.bodyText}`,
  },

  // selectors: {
  //   '[data-disabled="true"]': {
  //     pointerEvents: "none",
  //     opacity: 0.5,
  //   },
  // },
});

export const contextMenuCheckboxItemSpan = style({
  position: "absolute",
  left: "2px",
  display: "flex",
  height: "3.5rem",
  width: "3.5rem",
  alignItems: "center",
  justifyContent: "center",
});

export const contextMenuCheckboxItemSpanIcon = style({
  height: "1rem",
  width: "1rem",
});

export const contextMenuRadioItem = style({
  position: "relative",
  display: "flex",
  cursor: "default",
  userSelect: "none",
  alignItems: "center",
  borderRadius: "0.25rem",
  paddingTop: "0.375rem",
  paddingLeft: "2rem",
  paddingRight: "0.5rem",
  fontSize: `${vars.size.bodyFontSize}`,
  outline: "none",

  ":focus": {
    backgroundColor: `${vars.color.darkBackground}`,
    color: `${vars.color.bodyText}`,
  },

  // selectors: {
  //   '[data-disabled="true"]': {
  //     pointerEvents: "none",
  //     opacity: 0.5,
  //   },
  // },
});

export const contextMenuRadioItemSpan = style({
  position: "absolute",
  left: "2px",
  display: "flex",
  height: "3.5rem",
  width: "3.5rem",
  alignItems: "center",
  justifyContent: "center",
});

export const contextMenuRadioItemSpanIcon = style({
  height: "1rem",
  width: "1rem",
  fill: "currentColor",
});

export const contextMenuLabel = style({
  padding: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px`,
  fontSize: "12px",
  fontWeight: "600",
  color: `${vars.color.bodyText}`,
});

export const contextMenuLabelInset = style({
  paddingLeft: `${SPACING_UNIT * 4}px`,
});

export const contextMenuSeparator = style({
  margin: "-4px 4px 4px -4px",
  height: "1px",
  backgroundColor: `${vars.color.darkBackground}`,
});

export const contextMenuShortcut = style({
  marginLeft: "auto",
  fontSize: "12px",
  letterSpacing: "0.125em",
  color: `${vars.color.bodyText}`,
});
