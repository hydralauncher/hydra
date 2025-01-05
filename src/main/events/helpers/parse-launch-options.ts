export const parseLaunchOptions = (params: string | null): string[] => {
  if (!params) {
    return [];
  }

  return params.split(" ");
};
