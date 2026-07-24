export const BIG_PICTURE_UI_SCALE_VALUES = [
  75, 100, 125, 150, 175, 200,
] as const;

export type BigPictureUiScale = (typeof BIG_PICTURE_UI_SCALE_VALUES)[number];

export const DEFAULT_BIG_PICTURE_UI_SCALE: BigPictureUiScale = 100;

export function resolveBigPictureUiScale(value: unknown): BigPictureUiScale {
  return BIG_PICTURE_UI_SCALE_VALUES.includes(value as BigPictureUiScale)
    ? (value as BigPictureUiScale)
    : DEFAULT_BIG_PICTURE_UI_SCALE;
}

export function getBigPictureZoomFactor(value: unknown) {
  return resolveBigPictureUiScale(value) / 100;
}
