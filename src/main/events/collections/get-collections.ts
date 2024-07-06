import { collectionRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const getCollections = async () =>
  collectionRepository.find({
    relations: {
      games: {
        downloadQueue: true,
        repack: true,
      },
    },
    order: {
      title: "asc",
    },
  });

registerEvent("getCollections", getCollections);
