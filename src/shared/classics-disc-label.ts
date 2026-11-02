import type { ClassicsDisc } from "@types";

export const stripFileExtension = (fileName: string) => {
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
};

export const getClassicsDiscLabel = (
  disc: Pick<ClassicsDisc, "label" | "fileName" | "isExecutable">
) => (disc.isExecutable ? stripFileExtension(disc.fileName) : disc.label);

export const getNextClassicsDiscLabel = (
  discs: Pick<ClassicsDisc, "isExecutable">[]
) => `Disc ${discs.filter((disc) => !disc.isExecutable).length + 1}`;
