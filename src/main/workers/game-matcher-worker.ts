import { parentPort } from "worker_threads";
import crypto from "node:crypto";

export type TitleHashMapping = Record<string, number[]>;

export type FormattedSteamGame = {
  id: string;
  name: string;
  formattedName: string;
};
export type FormattedSteamGamesByLetter = Record<string, FormattedSteamGame[]>;

interface DownloadToMatch {
  title: string;
  uris: string[];
  uploadDate: string;
  fileSize: string;
}

interface MatchedDownload {
  title: string;
  uris: string[];
  uploadDate: string;
  fileSize: string;
  objectIds: string[];
  usedHashMatch: boolean;
}

interface MatchRequest {
  downloads: DownloadToMatch[];
  steamGames: FormattedSteamGamesByLetter;
  titleHashMapping: TitleHashMapping;
}

interface MatchResponse {
  matchedDownloads: MatchedDownload[];
  stats: {
    hashMatchCount: number;
    fuzzyMatchCount: number;
    noMatchCount: number;
  };
}

const hashTitle = (title: string): string => {
  return crypto.createHash("sha256").update(title).digest("hex");
};

const formatName = (name: string) => {
  return name
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
};

const formatRepackName = (name: string) => {
  return formatName(name.replace("[DL]", ""));
};

const matchDownloads = (request: MatchRequest): MatchResponse => {
  const { downloads, steamGames, titleHashMapping } = request;
  const matchedDownloads: MatchedDownload[] = [];

  let hashMatchCount = 0;
  let fuzzyMatchCount = 0;
  let noMatchCount = 0;

  for (const download of downloads) {
    let objectIds: string[] = [];
    let usedHashMatch = false;

    const titleHash = hashTitle(download.title);
    const steamIdsFromHash = titleHashMapping[titleHash];

    if (steamIdsFromHash && steamIdsFromHash.length > 0) {
      hashMatchCount++;
      usedHashMatch = true;
      objectIds = steamIdsFromHash.map(String);
    }

    if (!usedHashMatch) {
      let gamesInSteam: FormattedSteamGame[] = [];
      const formattedTitle = formatRepackName(download.title);

      if (formattedTitle && formattedTitle.length > 0) {
        const [firstLetter] = formattedTitle;
        const games = steamGames[firstLetter] || [];

        gamesInSteam = games.filter((game) =>
          formattedTitle.startsWith(game.formattedName)
        );

        if (gamesInSteam.length === 0) {
          gamesInSteam = games.filter(
            (game) =>
              formattedTitle.includes(game.formattedName) ||
              game.formattedName.includes(formattedTitle)
          );
        }

        if (gamesInSteam.length === 0) {
          for (const letter of Object.keys(steamGames)) {
            const letterGames = steamGames[letter] || [];
            const matches = letterGames.filter(
              (game) =>
                formattedTitle.includes(game.formattedName) ||
                game.formattedName.includes(formattedTitle)
            );
            if (matches.length > 0) {
              gamesInSteam = matches;
              break;
            }
          }
        }

        if (gamesInSteam.length > 0) {
          fuzzyMatchCount++;
          objectIds = gamesInSteam.map((game) => String(game.id));
        } else {
          noMatchCount++;
        }
      } else {
        noMatchCount++;
      }
    }

    matchedDownloads.push({
      ...download,
      objectIds,
      usedHashMatch,
    });
  }

  return {
    matchedDownloads,
    stats: {
      hashMatchCount,
      fuzzyMatchCount,
      noMatchCount,
    },
  };
};

// Message handler
if (parentPort) {
  parentPort.on("message", (message: { id: string; data: MatchRequest }) => {
    try {
      const result = matchDownloads(message.data);
      parentPort!.postMessage({ id: message.id, success: true, result });
    } catch (error) {
      parentPort!.postMessage({
        id: message.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
