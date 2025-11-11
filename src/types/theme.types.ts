export interface Theme {
  id: string;
  name: string;
  author?: string;
  authorName?: string;
  isActive: boolean;
  code: string;
  hasCustomSound?: boolean;
  originalSoundPath?: string;
  createdAt: Date;
  updatedAt: Date;
}
