interface BigPictureI18nResourceStore {
  addResourceBundle: (
    language: string,
    namespace: string,
    resources: Record<string, string>,
    deep?: boolean,
    overwrite?: boolean
  ) => unknown;
}

export function registerBigPictureI18nResources(
  i18n: BigPictureI18nResourceStore,
  resourcesByLanguage: Record<string, Record<string, string>>
) {
  for (const [language, resources] of Object.entries(resourcesByLanguage)) {
    i18n.addResourceBundle(language, "big_picture", resources, true, true);
  }
}
