<div align="center">

[<img src="../resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra on mängulauncher oma sisseehitatud bittorrenti kliendiga.</strong>
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
[![ee](https://img.shields.io/badge/lang-et-blue.svg)](README.et.md)

![Hydra Kataloog](screenshot.png)

</div>

## Sisukord

- [Sisukord](#sisukord)
- [Tutvustus](#tutvustus)
- [Funktsioonid](#funktsioonid)
- [Paigaldamine](#paigaldamine)
- [Panustamine](#panustamine)
  - [Liitu meie Telegramiga](#liitu-meie-telegramiga)
  - [Forki ja klooni oma repositoorium](#forki-ja-klooni-oma-repositoorium)
  - [Viisid panustamiseks](#viisid-panustamiseks)
  - [Projekti Struktuur](#projekti-struktuur)
- [Lähtekoodi kompileerimine](#lähtekoodi-kompileerimine)
  - [Node.js paigaldamine](#nodejs-paigaldamine)
  - [Yarn'i paigaldamine](#yarni-paigaldamine)
  - [Node sõltuvuste paigaldamine](#node-sõltuvuste-paigaldamine)
  - [Python 3.9 paigaldamine](#python-39-paigaldamine)
  - [Python'i sõltuvuste paigaldamine](#pythoni-sõltuvuste-paigaldamine)
- [Keskkonna muutujad](#keskkonna-muutujad)
- [Käivitamine](#käivitamine)
- [Kompileerimine](#kompileerimine)
  - [Bittorrenti kliendi kompileerimine](#bittorrenti-kliendi-kompileerimine)
  - [Electron rakenduse kompileerimine](#electron-rakenduse-kompileerimine)
- [Panustajad](#panustajad)
- [Litsents](#litsents)

## Tutvustus

**Hydra** on **Mängulauncher** oma sisseehitatud **BitTorrent Kliendiga**.
<br>
Launcher on kirjutatud TypeScriptis (Electron) ja Pythonis, mis haldab torrentide süsteemi kasutades libtorrenti.

## Funktsioonid

- Sisseehitatud bittorrenti klient
- How Long To Beat (HLTB) integratsioon mängu lehel
- Allalaadimiste kausta kohandamine
- Windowsi ja Linuxi tugi
- Pidevad uuendused
- Ja palju muud ...

## Paigaldamine

Järgi paigaldamiseks järgmisi samme:

1. Lae alla Hydra uusim versioon [Releases](https://github.com/hydralauncher/hydra/releases/latest) lehelt.
   - Lae alla ainult .exe fail, kui soovid paigaldada Hydrat Windowsile.
   - Lae alla .deb või .rpm või .zip fail, kui soovid paigaldada Hydrat Linuxile. (sõltub sinu Linuxi distrost)
2. Käivita allalaaditud fail.
3. Naudi Hydrat!

## Panustamine

### Liitu meie Telegramiga

Me keskendume aruteludele meie [Telegrami](https://t.me/hydralauncher) kanalis.

### Forki ja klooni oma repositoorium

1. Forki repositoorium [(klõpsa siia forkimiseks)](https://github.com/hydralauncher/hydra/fork)
2. Klooni oma forkitud kood `git clone https://github.com/your_username/hydra`
3. Loo uus haru
4. Pushi oma commitid
5. Esita uus Pull Request

### Viisid panustamiseks

- Tõlkimine: Me soovime, et Hydra oleks kättesaadav võimalikult paljudele inimestele. Võid aidata tõlkida uutesse keeltesse või uuendada ja parandada juba olemasolevaid tõlkeid Hydras.
- Kood: Hydra on ehitatud kasutades TypeScripti, Electroni ja natuke Pythonit. Kui soovid panustada, liitu meie [Telegramiga](https://t.me/hydralauncher)!

### Projekti Struktuur

- torrent-client: Kasutame libtorrenti, Pythoni teeki, torrentide allalaadimiste haldamiseks
- src/renderer: rakenduse kasutajaliides
- src/main: kogu loogika asub siin.

## Lähtekoodi kompileerimine

### Node.js paigaldamine

Veendu, et Node.js on sinu arvutisse paigaldatud. Kui ei ole, lae alla ja paigalda see [nodejs.org](https://nodejs.org/) lehelt.

### Yarn'i paigaldamine

Yarn on Node.js paketihaldur. Kui sa pole Yarni veel paigaldanud, saad seda teha järgides juhiseid [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/) lehel.

### Node sõltuvuste paigaldamine

Liigu projekti kausta ja paigalda Node sõltuvused kasutades Yarni:

```bash
cd hydra
yarn
```

### Python 3.9 paigaldamine

Veendu, et Python 3.9 on sinu arvutisse paigaldatud. Saad selle alla laadida ja paigaldada [python.org](https://www.python.org/downloads/release/python-3913/) lehelt.

### Python'i sõltuvuste paigaldamine

Paigalda vajalikud Pythoni sõltuvused kasutades pip'i:

```bash
pip install -r requirements.txt
```

## Keskkonna muutujad

Sul on vaja SteamGridDB API võtit, et laadida alla mängude ikoone paigaldamisel.

Kui sul on see olemas, saad kopeerida või ümber nimetada `.env.example` faili `.env` failiks ja lisada sinna `STEAMGRIDDB_API_KEY`.

## Käivitamine

Kui kõik on seadistatud, saad käivitada järgmise käsu, et käivitada nii Electroni protsess kui ka bittorrenti klient:

```bash
yarn dev
```

## Kompileerimine

### Bittorrenti kliendi kompileerimine

Kompileeri bittorrenti klient kasutades järgmist käsku:

```bash
python torrent-client/setup.py build
```

### Electron rakenduse kompileerimine

Kompileeri Electron rakendus kasutades järgmist käsku:

Windowsil:

```bash
yarn build:win
```

Linuxil:

```bash
yarn build:linux
```

## Panustajad

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## Litsents

Hydra on litsentseeritud [MIT Litsentsi](LICENSE) all.
