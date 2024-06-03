import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const getLibrary = async () =>
  gameRepository.find({
    where: {
      isDeleted: false,
    },
    order: {
      updatedAt: "desc",
    },
  });

registerEvent("getLibrary", getLibrary);
