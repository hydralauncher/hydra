export interface Theme {
  id: string;
  name: string;
  author?: string;
  authorName?: string;
  isActive: boolean;
  code: string;
  hasCustomSound?: boolean;
  originalSoundPath?: string;
  readOnly?: boolean;
  createdAt: Date;
  updatedAt: Date;
}
