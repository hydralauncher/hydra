import { z } from "zod";
import fs from "fs";
import path from "path";
import { Theme } from "@types";
import { logger } from "@main/services";

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

  const promises: Promise<Theme | null>[] = jsonFiles.map(async (file) => {
    try {
      const filepath: string = path.join(directory, file);
      const data: string = await fs.promises.readFile(filepath, "utf8");
      const json: any = JSON.parse(data);
      return themeSchema.parse(json);
    } catch (error) {
      logger.log("error", `Error parsing ${error}`);
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter((theme): theme is Theme => theme !== null);
};
