import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel } from "@main/level";

const getLibrary = async () => {
  return gamesSublevel
    .iterator()
    .all()
    .then((results) => {
      return Promise.all(
        results
          .filter(([_key, game]) => game.isDeleted === false)
          .map(async ([key, game]) => {
            const download = await downloadsSublevel.get(key);

            return {
              ...game,
              download,
            };
          })
      );
    });
};

registerEvent("getLibrary", getLibrary);
