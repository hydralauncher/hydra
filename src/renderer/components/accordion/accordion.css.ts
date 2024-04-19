import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { keyframes, style } from "@vanilla-extract/css";

export const accordionItem = style({
  borderBottom: "1px solid transparent",
});

export const accordionHeader = style({
  display: "flex",
});

export const accordionTrigger = style({
  display: "flex",
  flex: 1,
  alignItems: "center",
  padding: `${SPACING_UNIT * 2}px 0`,
  fontSize: vars.size.bodyFontSize,
  transition: "all cubic-bezier(0.4, 0, 0.2, 1) 150ms",
  color: vars.color.bodyText,

  ":hover": {
    textDecoration: "underline",
    textUnderlineOffset: `${SPACING_UNIT * 0.25}px`,
    cursor: "pointer",
  },
  // [&[data-state=open]>svg]:rotate-180 --> don't know how to select this shit
});

export const accordionIcon = style({
  width: "16px",
  height: "16px",
  color: vars.color.bodyText,
  marginRight: `${SPACING_UNIT}px`,
  transition: "transform cubic-bezier(0.4, 0, 0.2, 1) 200ms",
  flexShrink: 0,
});

export const accordionContent = style({
  overflow: "hidden",
  fontSize: vars.size.bodyFontSize,

  // --> well, guess what
  // data-[state=closed]:animate-accordion-up
  // data-[state=open]:animate-accordion-down
});

export const accordionChildrenContainer = style({
  paddingBottom: `${SPACING_UNIT * 2}px`,
  paddingTop: 0,
});

const accordionDownKeyframes = keyframes({
  from: { height: "0" },
  to: { height: "var(--radix-accordion-content-height)" },
});

const accordionUpKeyframes = keyframes({
  from: { height: "var(--radix-accordion-content-height)" },
  to: { height: "0" },
});

export const accordionDown = style({
  animationName: accordionDownKeyframes,
  animationDuration: "0.2s",
  animationTimingFunction: "ease-out",
});

export const accordionUp = style({
  animationName: accordionUpKeyframes,
  animationDuration: "0.2s",
  animationTimingFunction: "ease-out",
});
