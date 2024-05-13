import {Repack} from "../../entity";
import {JSDOM} from "jsdom";
import makeFetchCookie from "fetch-cookie";
import parseTorrent, {
  toMagnetURI,
  Instance as TorrentInstance,
} from "parse-torrent";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { logger } from "../logger";
import { parse, setHours, setMinutes, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import { requestWebPage, savePage } from "./helpers";
import { formatBytes } from "@shared";

const formatByrutDate = (dateStr: string) => {
  const isToday = dateStr.includes('Сегодня')
  const isYesterday = dateStr.includes('Вчера')

  const debloatedString = dateStr.replace('Публикация обновлена - ', '').replace('. ', '')

  const date = new Date()

  if (isToday || isYesterday) {
    const [, time] = debloatedString.split(',')

    const [hours, minutes] = time.split('"')


    setHours(date, Number(hours))
    setMinutes(date, Number(minutes))

    if (isYesterday) {
      subDays(date, 1)
    }

    return date
  }

  return parse(debloatedString, "d LLLL yyyy, H:mm", date, {locale: ru}).toISOString()
}

export const requestByrut = (path: string) => requestWebPage(`https://byruthub.org${path}`)

export const getRepackFromByrut = async (href: string) => {
  const http = makeFetchCookie(fetch);

  const data = await requestWebPage(href);

  const {window} = new JSDOM(data)
  
  const pageDocument = window.document

  const torrentButton = pageDocument.querySelector<HTMLAnchorElement>('.itemtop_games')

  if (!torrentButton) {
    throw new Error("Download button not found")
  }
  
  const torrentLink = torrentButton.href!

  const updateDate = pageDocument.querySelector('tupd')?.textContent

  const contents = await http(torrentLink)

  const contentsBuffer = await contents.arrayBuffer()

  const torrentFile = Buffer.from(contentsBuffer)

  const torrent = parseTorrent(torrentFile) as TorrentInstance;

  const magnetLink = toMagnetURI({
        infoHash: torrent.infoHash,
      });

  const torrentSizeInBytes = torrent.length;

  if (!torrentSizeInBytes) {
    throw new Error('Cant get torrent file size')
  };

  return {
    fileSize: formatBytes(torrentSizeInBytes ?? 0),
    updatedAt: formatByrutDate(updateDate!),
    magnet: magnetLink,
  } as Repack
}

export const getNewRepacksFromByrut = async (existingRepacks: Repack[] = [], page = 1) => {
  const data = await requestByrut(`/page/${page}/`)

  const {window} = new JSDOM(data)

  const repacks: QueryDeepPartialEntity<Repack>[] = [];

  const document = window.document

  const lastPage = document.querySelector<HTMLDivElement>('.pages')!.textContent!

  for (const $item of  document.querySelectorAll<HTMLDivElement>('#dle-content > .short_item')) {
    try {
      const titleElement = $item.querySelector<HTMLAnchorElement>('.short_title > a')
    const gameTitle = titleElement!.textContent!

    const gameLink = titleElement?.href!

    const repackInfo = await getRepackFromByrut(gameLink)

    repacks.push({
      ...repackInfo,
      repacker: 'ByRutor',
      title: gameTitle,
      page,
    })
    } catch (err) {
      logger.error((err as Error).message, {
        method: "getNewRepacksFromByrut",
      });
    }
  }

  const newRepacks = repacks.filter(
    (repack) =>
      !existingRepacks.some(
        (existingRepack) => existingRepack.title === repack.title
      )
  );

  if (!newRepacks.length) return

  if (page === Number(lastPage)) return

  await savePage(repacks)

  return getNewRepacksFromByrut(existingRepacks, page + 1)
}
