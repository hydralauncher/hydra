export const parseLaunchOptions = (params: string | null): string[] => {
  if (params == null || params == "") {
    return [];
  }

  const paramsSplit = params.split(" ");

  return paramsSplit;
};
