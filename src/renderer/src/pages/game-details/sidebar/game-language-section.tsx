import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context/game-details/game-details.context";
import { SidebarSection } from "../sidebar-section/sidebar-section";

export function GameLanguageSection() {
  const { t } = useTranslation("game_details");
  const { shopDetails, objectId } = useContext(gameDetailsContext);

  const getLanguages = () => {
    let languages = shopDetails?.supported_languages;
    if (!languages) return [];
    languages = languages?.split('<br>')[0];
    let arrayIdiomas = languages?.split(',')
    let listLanguages: { language: string; caption: string; audio: string }[] = [];
    arrayIdiomas?.forEach((lang) => {
      const objectLanguage = { 
        language: lang.replace("<strong>*</strong>", ""), 
        caption: "✔", 
        audio: lang.includes("*") ? "✔" : "" };
      listLanguages.push(objectLanguage);
    })
    return listLanguages;
  }


  return (
        <SidebarSection title={t("language")}>
      <div>
        <h4>{t("supported_languages")}</h4>
        <table className="table-languages">
          <thead>
            <tr>
              <th>{t("language")}</th>
              <th>{t("caption")}</th>
              <th>{t("audio")}</th>
            </tr>
          </thead>
          <tbody>
            {getLanguages().map((lang) => (
              <tr key={lang.language}>
                <td>{lang.language}</td>
                <td>{lang.caption}</td>
                <td>{lang.audio}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <a target="_blank" rel="noopener noreferrer" className="list__item" href={`https://store.steampowered.com/app/${objectId}`}>Link Steam</a>
      </div>
    </SidebarSection>
  );
}