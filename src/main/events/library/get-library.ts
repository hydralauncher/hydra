import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const getLibrary = async () =>
  gameRepository.find({
    where: {
      isDeleted: false,
    },
    order: {
      createdAt: "desc",
    },
  });

registerEvent("getLibrary", getLibrary);
