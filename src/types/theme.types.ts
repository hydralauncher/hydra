import { isValidHexColor } from "@main/helpers";
import { z } from "zod";

const hexColorSchema = z.string().refine(isValidHexColor);
type HexColorType = z.infer<typeof hexColorSchema>;

export interface Theme {
  id: string;
  name: string;
  colors: {
    accent: HexColorType;
    background: HexColorType;
    surface: HexColorType;
    optional1?: HexColorType;
    optional2?: HexColorType;
  };
  description?: string;
  author: string | undefined;
  authorName: string | undefined;
  isActive: boolean;
  code: string;
  createdAt: Date;
  updatedAt: Date;
}
