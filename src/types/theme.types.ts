import { z } from "zod";

const isValidHexColor = (color: string): boolean => {
  const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  return hexColorRegex.test(color);
};

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
