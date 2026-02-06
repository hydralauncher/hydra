import stringArgv from 'string-argv';

export const parseLaunchOptions = (params?: string | null): string[] => {
  if (!params) {
    return [];
  }

  return stringArgv(params);
};
