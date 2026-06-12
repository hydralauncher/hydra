let importing = false;

export const setClassicsImporting = (value: boolean) => {
  importing = value;
};

export const isClassicsImporting = () => importing;
