import fs from "fs";

export default function validatePath(path: string): Error | undefined {
  try {
    fs.accessSync(path, fs.constants.W_OK);
    return;
  } catch (error) {
    return error as Error;
  }
}
