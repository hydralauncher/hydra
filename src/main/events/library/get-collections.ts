import type { Collection } from "@types";
import { registerEvent } from "../register-event";
import { collectionsSublevel } from "@main/level";

const getCollections = async (): Promise<Collection[]> => {
  return collectionsSublevel
    .iterator()
    .all()
    .then((results) => {
      return results.map(([_key, collection]) => collection);
    });
};

registerEvent("getCollections", getCollections);
