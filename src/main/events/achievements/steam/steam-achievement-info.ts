import { logger } from "@main/services";
import { AchievementInfo } from "../types";
import { JSDOM } from "jsdom";

export const steamAchievementInfo = async (
  objectId: string
): Promise<AchievementInfo[] | undefined> => {
  const fetchUrl = `https://steamcommunity.com/stats/${objectId}/achievements`;

  const achievementInfosHtmlText = await fetch(fetchUrl, {
    method: "GET",
    //headers: { "Accept-Language": "" },
  })
    .then((res) => {
      if (res.status === 200) return res.text();
      throw new Error();
    })
    .catch((err) => {
      logger.error(err, { method: "getSteamGameAchievements" });
      return;
    });

  if (!achievementInfosHtmlText) return;

  const achievementInfos: AchievementInfo[] = [];

  const window = new JSDOM(achievementInfosHtmlText).window;

  const itens = Array.from(
    window.document.getElementsByClassName("achieveRow")
  );

  for (const item of itens) {
    const imageUrl = item
      .getElementsByClassName("achieveImgHolder")?.[0]
      .getElementsByTagName("img")?.[0]?.src;

    const achievementName = item
      .getElementsByClassName("achieveTxt")?.[0]
      .getElementsByTagName("h3")?.[0].innerHTML;

    const achievementDescription = item
      .getElementsByClassName("achieveTxt")?.[0]
      .getElementsByTagName("h5")?.[0].innerHTML;

    achievementInfos.push({
      imageUrl: imageUrl ?? "",
      title: achievementName ?? "",
      description: achievementDescription ?? "",
    });
  }

  return achievementInfos;
};
