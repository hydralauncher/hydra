import { Theme } from "@types";

const defaultThemes: Theme[] = [
  {
    name: "Hydra",
    createdBy: "Hydra",
    scheme: {
      background: "#1c1c1c",
      darkBackground: "#151515",
      muted: "#c0c1c7",
      bodyText: "#8e919b",
      border: "#424244",
    },
  },
  {
    name: "Hydra-amoled",
    createdBy: "Hydra",
    scheme: {
      background: "#000000",
      darkBackground: "#000000",
      muted: "#ffffff",
      bodyText: "#ffffff",
      border: "#ffffff",
    },
  },
  {
    name: "Hydra-light",
    createdBy: "Hydra",
    scheme: {
      background: "#fafafa",
      darkBackground: "#efefef",
      muted: "#6c6166",
      bodyText: "#26292f",
      border: "#e1e1e1",
    },
  },
];

export default defaultThemes;
