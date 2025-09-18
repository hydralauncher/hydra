import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import createDesktopShortcut from "create-desktop-shortcuts";
import { removeSymbolsFromName } from "@shared";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import { parseExecutablePath } from "@main/events/helpers/parse-executable-path";
import type { GameRef, GamesOrganizerResult } from "@types";

/**
 * Garante que a pasta de destino exista (cria recursivamente se não existir)
 *
 * @param folderPath Caminho desejado para a pasta
 * @returns true se a pasta existe ao final da execução
 */
export const ensureFolderExists = (folderPath: string): boolean => {
  const finalPath = path.resolve(folderPath);

  if (!fs.existsSync(finalPath)) {
    fs.mkdirSync(finalPath, { recursive: true });
    logger.info(`[gamesorganizer] Pasta criada: ${finalPath}`);
    return true;
  }

  logger.info(`[gamesorganizer] Pasta já existia: ${finalPath}`);
  return false;
};

/**
 * Cria um atalho para um jogo dentro de uma pasta de destino.
 * Não move arquivos do jogo, apenas cria um .lnk (Windows) ou atalho equivalente.
 *
 * @param folderPath Pasta onde o atalho será criado
 * @param shop Loja do jogo (ex.: steam)
 * @param objectId ID do jogo na loja
 * @returns true se o atalho foi criado com sucesso
 */
export const createGameShortcutInFolder = async (
  folderPath: string,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) {
    logger.warn(
      `[gamesorganizer] Jogo não encontrado no banco: shop=${shop}, objectId=${objectId}`
    );
    return false;
  }

  if (!game.executablePath) {
    logger.warn(
      `[gamesorganizer] Jogo sem executablePath: "${game.title}" (${shop}:${objectId})`
    );
    return false;
  }

  const parsedExecPath = parseExecutablePath(game.executablePath);
  const name = removeSymbolsFromName(game.title);
  const outDir = path.resolve(folderPath);

  // Garante pasta
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Ajuste específico Windows (mesma abordagem usada na criação de atalho da área de trabalho)
  const windowVbsPath = app.isPackaged
    ? path.join(process.resourcesPath, "windows.vbs")
    : undefined;

  const options = {
    filePath: parsedExecPath,
    name,
    outputPath: outDir,
  } as const;

  const ok = createDesktopShortcut({
    windows: { ...options, VBScriptPath: windowVbsPath },
    linux: options,
    osx: options,
  });

  if (ok) {
    logger.info(
      `[gamesorganizer] Atalho criado com sucesso: "${name}" -> ${parsedExecPath} em ${outDir}`
    );
  } else {
    logger.error(
      `[gamesorganizer] Falha ao criar atalho: "${name}" -> ${parsedExecPath} em ${outDir}`
    );
  }

  return ok;
};

/**
 * Cria (se necessário) uma pasta e adiciona atalhos dos jogos escolhidos dentro dela.
 * Não move/renomeia nada do jogo instalado; apenas cria referências para facilitar o acesso.
 *
 * @param folderName Nome da pasta de destino (será criada no Desktop)
 * @param gameRefs Lista de jogos (shop + objectId) a serem adicionados
 * @returns Resumo da operação
 */
export const createFolderAndPlaceGames = async (
  folderName: string,
  gameRefs: GameRef[]
): Promise<GamesOrganizerResult> => {
  try {
    const target = path.join(os.homedir(), "Desktop", folderName);

    ensureFolderExists(target);

    const games = await Promise.all(
      gameRefs.map(async (gameRef) => {
        const gameKey = levelKeys.game(gameRef.shop, gameRef.objectId);
        const game = await gamesSublevel.get(gameKey);
        return game;
      })
    );

    let shortcutsCreated = 0;
    let skipped = 0;
    const failures: Array<{ game: GameRef; reason: string }> = [];

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      const gameRef = gameRefs[i];

      if (!game) {
        skipped++;
        continue;
      }

      try {
        await createGameShortcutInFolder(target, game.shop, game.objectId);
        shortcutsCreated++;
      } catch (error) {
        logger.error("Erro ao criar atalho para o jogo", game.title, error);
        failures.push({
          game: gameRef,
          reason: error instanceof Error ? error.message : "Erro desconhecido",
        });
      }
    }

    return {
      folderPath: target,
      createdFolder: true,
      shortcutsCreated,
      failures,
      skipped,
    };
  } catch (error) {
    logger.error("Erro ao criar pasta e organizar jogos:", error);
    return {
      folderPath: folderName,
      createdFolder: false,
      shortcutsCreated: 0,
      failures: gameRefs.map((gameRef) => ({
        game: gameRef,
        reason: error instanceof Error ? error.message : "Erro desconhecido",
      })),
      skipped: 0,
    };
  }
};
