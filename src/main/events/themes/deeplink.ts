// import { themes } from "@main/level/sublevels/themes";
// import { WindowManager } from "@main/services";
// import { Theme } from "@types";

// export const handleDeepLinkTheme = async (
//   themeName: string,
//   authorCode: string
// ) => {
//   const theme: Theme = {
//     id: crypto.randomUUID(),
//     name: themeName,
//     isActive: false,
//     author: authorCode,
//     authorName: "spectre",
//     code: `https://hydrathemes.shop/themes/${themeName}.css`,
//     createdAt: new Date(),
//     updatedAt: new Date(),
//   };

//   await themes.put(theme.id, theme);

//   const allThemes = await themes.values().all();
//   const activeTheme = allThemes.find((theme: Theme) => theme.isActive);

//   if (activeTheme) {
//     await themes.put(activeTheme.id, {
//       ...activeTheme,
//       isActive: false,
//     });
//   }

//   WindowManager.mainWindow?.webContents.send("css-injected", theme.code);

//   await themes.put(theme.id, {
//     ...theme,
//     isActive: true,
//   });
// };
