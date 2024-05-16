import { z } from "zod";
import fs from "fs";
import path from "path";
import { Theme } from "@types";

const themeSchema = z.object({
  name: z.string().min(3).max(12),
  createdBy: z.string().min(3).max(12),
  scheme: z.object({
    bodyText: z.string().min(1),
    background: z.string().min(1),
    darkBackground: z.string().min(1),
    border: z.string().min(1),
    muted: z.string().min(1),
  }),
});

export const readJSONFiles = async (directory: string): Promise<Theme[]> => {
  const files: string[] = await fs.promises.readdir(directory);
  const jsonFiles: string[] = files.filter(
    (file) => path.extname(file) === ".json"
  );

  const promises: Promise<Theme>[] = jsonFiles.map(async (file) => {
    const filepath: string = path.join(directory, file);
    const data: string = await fs.promises.readFile(filepath, "utf8");
    const json: string = JSON.parse(data);
    return themeSchema.parse(json);
  });

  return Promise.all(promises);
};
