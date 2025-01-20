import { dataSource } from "./data-source";
import { UserPreferences } from "@main/entity";

export const userPreferencesRepository =
  dataSource.getRepository(UserPreferences);
