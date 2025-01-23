export interface Theme {
  id: string;
  name: string;
  isActive: boolean;
  description: string;
  author: string | null;
  authorId: string | null;
  version: string;
  code: string;
  colors: {
    accent: string;
    surface: string;
    background: string;
    optional1?: string;
    optional2?: string;
  };
}

export class ThemesManager {}
