import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { SPACING_UNIT, vars } from "../../theme.css";

export const sidebar = recipe({
  base: {
    backgroundColor: vars.color.darkBackground,
    color: "#c0c1c7",
    display: "flex",
    flexDirection: "column",
    transition: "opacity ease 0.2s",
    borderRight: `solid 1px ${vars.color.borderColor}`,
    position: "relative",
  },
  variants: {
    resizing: {
      true: {
        opacity: vars.opacity.active,
        pointerEvents: "none",
      },
    },
  },
});

export const content = recipe({
  base: {
    display: "flex",
    flexDirection: "column",
    paddingBottom: "0",
    width: "100%",
    overflow: "auto",
    padding: `${SPACING_UNIT * 2}px`,
  },
  variants: {
    macos: {
      true: {
        paddingTop: `${SPACING_UNIT * 6}px`,
      },
    },
  },
});

export const handle = style({
  width: "5px",
  height: "100%",
  cursor: "col-resize",
  position: "absolute",
  right: "0",
});

export const menu = style({
  listStyle: "none",
  padding: "0",
  margin: "0",
  gap: `${SPACING_UNIT * 2}px`,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

export const menuItem = recipe({
  base: {
    transition: "all ease 0.1s",
    cursor: "pointer",
    textWrap: "nowrap",
    display: "flex",
    ":hover": {
      color: "#DADBE1",
    },
  },
  variants: {
    active: {
      true: {
        color: "#DADBE1",
        fontWeight: "bold",
      },
    },
    cancelled: {
      true: {
        opacity: vars.opacity.disabled,
        ":hover": {
          opacity: "1",
        },
      },
    },
  },
});

export const menuItemButton = style({
  color: "inherit",
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT}px`,
  cursor: "pointer",
  overflow: "hidden",
  width: "100%",
  selectors: {
    [`${menuItem({ active: true }).split(" ")[1]} &`]: {
      fontWeight: "bold",
    },
  },
});

export const menuItemButtonLabel = style({
  textOverflow: "ellipsis",
  overflow: "hidden",
});

export const gameIcon = style({
  width: "20px",
  height: "20px",
  borderRadius: "4px",
  backgroundSize: "cover",
});

export const sectionTitle = style({
  textTransform: "uppercase",
  fontWeight: "bold",
});

export const section = recipe({
  base: {
    padding: `${SPACING_UNIT * 2}px 0`,
    gap: `${SPACING_UNIT * 2}px`,
    display: "flex",
    flexDirection: "column",
  },
  variants: {
    hasBorder: {
      true: {
        borderBottom: `solid 1px ${vars.color.borderColor}`,
      },
    },
  },
});

export const sidebarFooter = style({
  marginTop: "auto",
  padding: `${SPACING_UNIT * 2}px`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
});

export const footerSocialsContainer = style({
  display: "flex",
  alignItems: "center",
  gap: `${SPACING_UNIT * 1.5}px`,
});

export const footerSocialsItem = style({
  color: vars.color.bodyText,
  backgroundColor: vars.color.darkBackground,
  width: "16px",
  height: "16px",
  display: "flex",
  alignItems: "center",
  transition: "all ease 0.15s",
  ":hover": {
    opacity: 0.75,
    cursor: "pointer",
  },
});

export const footerText = style({
  color: vars.color.bodyText,
  fontSize: "12px",
});
