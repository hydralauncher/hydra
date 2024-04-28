import type { Repack } from "@main/entity";
import { repackRepository } from "@main/repository";

import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

export const savePage = async (repacks: QueryDeepPartialEntity<Repack>[]) =>
  Promise.all(
    repacks.map((repack) => repackRepository.insert(repack).catch(() => {}))
  );

export const requestWebPage = async (url: string) =>
  fetch(url, {
    method: "GET",
  }).then((response) => response.text());
