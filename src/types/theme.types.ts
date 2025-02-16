export interface Theme {
  id: string;
  name: string;
  author: string | undefined;
  authorName: string | undefined;
  isActive: boolean;
  code: string;
  createdAt: Date;
  updatedAt: Date;
}
