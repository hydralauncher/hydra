import { keyframes } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

import { SPACING_UNIT, vars } from "../../theme.css";

export const backdropFadeIn = keyframes({
  "0%": { backdropFilter: "blur(0px)", backgroundColor: "rgba(0, 0, 0, 0.5)" },
  "100%": {
    backdropFilter: "blur(2px)",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
});

export const backdropFadeOut = keyframes({
  "0%": { backdropFilter: "blur(2px)", backgroundColor: "rgba(0, 0, 0, 0.7)" },
  "100%": {
    backdropFilter: "blur(0px)",
    backgroundColor: "rgba(0, 0, 0, 0)",
  },
});

export const backdrop = recipe({
  base: {
    animationName: backdropFadeIn,
    animationDuration: "0.4s",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    position: "absolute",
    width: "100%",
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: vars.zIndex.backdrop,
    top: "0",
    padding: `${SPACING_UNIT * 3}px`,
    backdropFilter: "blur(2px)",
    transition: "all ease 0.2s",
  },
  variants: {
    closing: {
      true: {
        animationName: backdropFadeOut,
        backdropFilter: "blur(0px)",
        backgroundColor: "rgba(0, 0, 0, 0)",
      },
    },
    windows: {
      true: {
        // SPACING_UNIT * 3 + title bar spacing
        paddingTop: `${SPACING_UNIT * 3 + 35}px`,
      },
    },
  },
});
