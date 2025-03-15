<br>

<div align="center">

[<img src="../resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra - гэта гульнявы лаўнчар з уласным убудаваным кліентам BitTorrent.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

[![pt-BR](https://img.shields.io/badge/lang-pt--BR-green.svg)](README.pt-BR.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](../README.md)
[![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)
[![uk-UA](https://img.shields.io/badge/lang-uk--UA-blue)](README.uk-UA.md)
[![be](https://img.shields.io/badge/lang-be-orange)](README.be.md)
[![es](https://img.shields.io/badge/lang-es-red)](README.es.md)
[![fr](https://img.shields.io/badge/lang-fr-blue)](README.fr.md)
[![de](https://img.shields.io/badge/lang-de-black)](README.de.md)
[![ita](https://img.shields.io/badge/lang-it-red)](README.it.md)
[![cs](https://img.shields.io/badge/lang-cs-purple)](README.cs.md)
[![da](https://img.shields.io/badge/lang-da-red)](README.da.md)
[![nb](https://img.shields.io/badge/lang-nb-blue)](README.nb.md)
[![et](https://img.shields.io/badge/lang-et-blue.svg)](README.et.md)
[![tr](https://img.shields.io/badge/lang-tr-red.svg)](README.tr.md)

![Hydra Catalogue](screenshot.png)

</div>

## Змест

- [Змест](#змест)
- [Апісанне](#апісанне)
- [Асаблівасці](#асаблівасці)
- [Усталёўка](#усталёўка)
- [Уклад](#-уклад)
  - [Далучайцеся да нашага Telegram](#-далучайцеся-да-нашага-telegram)
  - [Форк і кланаванне рэпазітара](#форк-і-кланаванне-рэпазітара)
  - [Спосабы ўнесці свой уклад](#спосабы-ўнесці-свой-уклад)
  - [Структура праекту](#структура-праекту)
- [Зборка з зыходнага коду](#зборка-з-зыходнага-коду)
  - [Усталёўка Node.js](#усталёўка-nodejs)
  - [Усталёўка Yarn](#усталёўка-yarn)
  - [Усталёўка залежнасцяў Node](#усталёўка-залежнасцяў-node)
  - [Усталёўка Python 3.9](#усталёўка-python-39)
  - [Усталёўка залежнасцяў Python](#усталёўка-залежнасцяў-python)
- [Пераменныя асяроддзі](#пераменныя-асяроддзі)
- [Запуск](#запуск)
- [Зборка](#зборка)
  - [Зборка кліента BitTorrent](#зборка-кліента-bittorrent)
  - [Зборка прыкладання Electron](#зборка-прыкладання-electron)
- [Удзельнікі](#удзельнікі)
- [Ліцэнзія](#ліцэнзія)

## Апісанне

**Hydra** - гэта **гульнявы лаўнчар** з уласным убудаваным **кліентам BitTorrent** і **самастойным scraper`ом для рэпакаў**.
<br>
Лаўнчар напісаны на TypeScript (Electron) і Python, які кіруе сістэмай торэнтаў з дапамогай libtorrent.

## Асаблівасці

- Самастойны scraper рэпакаў сярод усіх найбольш надзейных вэб-сайтаў у [Megathread](https://www.reddit.com/r/Piracy/wiki/megathread/)
- Убудаваны кліент BitTorrent
- Інтэграцыя How Long To Beat (HLTB) на старонцы гульні
- Настройка шляху сцягвання
- Паведамленні аб абнаўленні спісу рэпакаў
- Падтрымка Windows і Linux
- Рэгулярныя абнаўленні
- І многае іншае...

## Усталёўка

Каб усталяваць, выканайце наступныя крокі:

1. Спампуйце апошнюю версію Hydra з [старонкі рэлізаў](https://github.com/hydralauncher/hydra/releases/latest).
   - Загрузіце толькі .exe, калі жадаеце ўсталяваць Hydra на Windows.
   - Загрузіце .deb ці .rpm ці .zip, калі жадаеце ўсталяваць Hydra на Linux (у залежнасці ад вашага дыстрыбутыва Linux).
2. Запусціце спампаваны файл.
3. Атрымлівайце асалоду ад Hydra!

## <a name="contributing"> Уклад

### <a name="join-our-telegram"></a> Далучайцеся да нашага Telegram

Мы засяроджваем нашы абмеркаванні ў нашым канале [Telegram](https://t.me/hydralauncher).

### Форк і кланаванне рэпазітара

1. Форкніце рэпазітар [(націсніце тут, каб зрабіць форк зараз)](https://github.com/hydralauncher/hydra/fork)
2. Склануйце свой форкнуты код `git clone https://github.com/ваше_имя_пользователя/hydra`
3. Стварыце новую галіну
4. Адпраўце свае каміты
5. Адпраўце Pull Request

### Спосабы ўнесці свой уклад

- Пераклад: Мы хочам, каб Hydra была даступная як мага большай колькасці людзей. Не саромейцеся дапамагаць перакладаць на новыя мовы ці абнаўляць і паляпшаць тыя, якія ўжо даступныя ў Hydra.
- Код: Hydra створаны з выкарыстаннем TypeScript, Electron і крыху Python. Калі хочаце ўнесці свой уклад, далучайцеся да нашага канала [Telegram](https://t.me/hydralauncher)!

### Структура праекту

- torrent-client: Мы выкарыстоўваем libtorrent, бібліятэку Python, для кіравання торэнт-загрузкамі.
- src/renderer: Карыстацкі інтэрфейс прыкладання.
- src/main: Увесь асноўны функцыянал тут.

## Зборка з зыходнага коду

### Усталёўка Node.js

Упэўніцеся, што ў вас усталяваны Node.js на вашым кампутары. Калі не, загрузіце і ўсталюйце яго з [nodejs.org](https://nodejs.org/).

### Усталёўка Yarn

Yarn - мэнэджэр пакетаў для Node.js. Калі вы яшчэ не ўсталявалі Yarn, зрабіце гэта, прытрымліваючыся інструкцыям на [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Усталёўка залежнасцяў Node

Перайдзіце ў каталог праекта і ўсталюйце залежнасці Node, выкарыстоўваючы Yarn:

```bash
cd hydra
yarn
```

### Усталёўка Python 3.9

Упэўніцеся, што ў вас усталяваны Python 3.9 на вашым кампутары. Вы можаце загрузіць і ўсталяваць яго з [python.org](https://www.python.org/downloads/release/python-3913/).

### Усталёўка залежнасцяў Python

Усталюйце неабходныя залежнасці Python, выкарыстоўваючы pip:

```bash
pip install -r requirements.txt
```

## Пераменныя асяроддзі

Вам спатрэбіцца ключ API SteamGridDB, каб атрымаць значкі гульняў пры ўсталёўкі.

Як толькі вы атрымаеце ключ, вы зможаце скапіяваць або пераназваць файл `.env.example` у `.env` і змясціць у яго `STEAMGRIDDB_API_KEY`.

## Запуск

Пасля таго як усё наладжана, вы можаце выканаць наступную каманду, каб запусціць працэс Electron і кліента BitTorrent:

```bash
yarn dev
```

## Зборка

### Зборка кліента BitTorrent

Збярыце кліент BitTorrent з дапамогай гэтай каманды:

```bash
python torrent-client/setup.py build
```

### Зборка прыкладання Electron

Збярыце прыкладанне Electron, выкарыстоўваючы гэтую каманду:

На Windows:

```bash
yarn build:win
```

На Linux:

```bash
yarn build:linux
```

## Удзельнікі

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## Ліцэнзія

Hydra ліцэнзавана ў адпаведнасці з [MIT License](LICENSE).
