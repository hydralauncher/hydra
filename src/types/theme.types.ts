export interface Theme {
  id: string;
  name: string;
  author?: string;
  authorName?: string;
  isActive: boolean;
  code: string;
  hasCustomSound?: boolean;
  createdAt: Date;
  updatedAt: Date;
}
