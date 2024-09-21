<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra er en spill launcher sin egen innebygt bittorrent klient.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

[![pt-BR](https://img.shields.io/badge/lang-pt--BR-green.svg)](README.pt-BR.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)
[![uk-UA](https://img.shields.io/badge/lang-uk--UA-blue)](README.uk-UA.md)
[![be](https://img.shields.io/badge/lang-be-orange)](README.be.md)
[![es](https://img.shields.io/badge/lang-es-red)](README.es.md)
[![fr](https://img.shields.io/badge/lang-fr-blue)](README.fr.md)
[![de](https://img.shields.io/badge/lang-de-black)](README.de.md)
[![ita](https://img.shields.io/badge/lang-it-red)](README.it.md)
[![cs](https://img.shields.io/badge/lang-cs-purple)](README.cs.md)
[![nb](https://img.shields.io/badge/lang-nb-blue)](README.nb.md)

![Hydra Catalogue](./docs/screenshot.png)

</div>

## Innhold

- [Innhold](#innhold)
- [Om](#om)
- [Funksjoner](#funksjoner)
- [Installasjon](#installasjon)
- [Bidra](#-bidra)
  - [Bli med i Telegram kanalen vår](#-join-our-telegram)
  - [Forke og klone repoet ditt](#fork-and-clone-your-repository)
  - [Måter du kan bidra](#ways-you-can-contribute)
  - [Prosjekt Struktur](#project-structure)
- [Bygg fra kilden](#build-from-source)
  - [Installere Node.js](#install-nodejs)
  - [Installere Yarn](#install-yarn)
  - [Installere Node-avhengigheter](#install-node-dependencies)
  - [Installere Python 3.9](#install-python-39)
  - [Installere Python-avhengigheter](#install-python-dependencies)
- [Miljøvariabler](#environment-variables)
- [Kjøre](#running)
- [Bygge](#build)
  - [Bygg bittorrent klienten](#build-the-bittorrent-client)
  - [Bygg Electron applikationen](#build-the-electron-application)
- [Bidragsytere](#contributors)
- [Lisens](#license)

## Om

**Hydra** er en **Spill Launcher** sin egne innbygte **BitTorrent Klient**.
<br>
Launcheren er skrevet i TypeScript (Electron) og Python, som håndterer torrent systemet ved bruk av libtorrent.

## Funksjoner

- Sin egen innebyggte bittorrent klient
- How Long To Beat (HLTB) integrasjon på spillsiden
- Nedlastingssti tilpasning
- Windows og Linux understøttelse
- Konstant oppdatert
- Og mer ...

## Installasjon

Følg trinnene her under for å innstallere:

1. Last ned den seneste versjonen av Hydra fra [Releases](https://github.com/hydralauncher/hydra/releases/latest) siden.
   - Last kun .exe filen ned om du vil installere Hydra på Windows.
   - Last kun .deb, .rpm eller .zip ned om du vil installere Hydra på Linux. (kommer an på Linux distroen din)
2. Kjør den nedlastede filen.
3. Nyt Hydra!

## <a name="contributing"> Bidra

### <a name="join-our-telegram"></a> Bli med i Telegram kanalen vår

Vi holder diskusjonene våres i [Telegram](https://t.me/hydralauncher) kanalen.

### Forke og klone repoet ditt

1. Fork repoet [(trykk her for å forke nå)](https://github.com/hydralauncher/hydra/fork)
2. Klon den forkede koden `git clone https://github.com/brukernavnet_ditt/hydra`
3. Lag en ny branch
4. Skyv committene dine
5. Send inn en ny Pull-forespørsel.

### Måter du kan bidra

- Oversetting: Vi har lyst at Hydra skal bli tilgjengelig for så mange som mulig. Hjelp gjerne med å oversette til nye språk eller oppdater og forbedre de som allerede er tilgjengelige i Hydra.
- Code: Hydra is built with Typescript, Electron and a little bit of Python. If you want to contribute, join our [Telegram](https://t.me/hydralauncher)!
- Kode: Hydra er laget med Typescript, Electron og lite gran Pythong. Hvis du har lyst på å bidra, bli med i [Telegram](https://t.me/hydralauncher) kanalen vår!

### Prosjektstruktur

- torrent-client: Vi bruker libtorrent, et Python-bibliotek, til å håndtere torrent nedlastinger.
- src/renderer: UIen til applikasjonen
- src/main: all logikken er her.

## Bygg fra kildekoden

### Installere Node.js

Vær sikker på at du har installert Node.js på maskinen din. Hvis du ikke har det, må du laste ned og installere det fra [nodejs.org](https://nodejs.org/).

### Installere Yarn

Yarn er et pakkehåndteringsverktøy til Node.js. Hvis du ikke allerede har installert Yarn, da kan du gjøre det ved å følge instruksjonene på [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Installere Node-avhengigheter

Naviger til prosjektmappen og installer Node-avhengighetene ved bruk av Yarn:

```bash
cd hydra
yarn
```

### Installere Python 3.9

Vær sikker på at du har installert Python 3.9 på maskinen din. Du kan laste ned og installere det på [python.org](https://www.python.org/downloads/release/python-3913/).

### Installere Python-avhengigheter

Installer de nødvendige Python-avhengigheter ved bruk av pip:

```bash
pip install -r requirements.txt
```

## Miljøvariabler

Du trenger en SteamGridDB API nøkkel for å kunne hente spillikonene ved installasjon.

Når du har det, kan du kopiere eller endre navnet på `.env.example` filen til å være `.env` og lagre nøkkelen som `STEAMGRIDDB_API_KEY`.

## Kjøre

Når alt er satt op, kan du kjøre følgende kommando for å start både Electron prosessen og bittorrent klienten.

```bash
yarn dev
```

## Bygge

### Bygge bittorrent klienten

Bygg bittorrent klienten ved å bruke denne kommandoen:

```bash
python torrent-client/setup.py build
```

### Bygge Electron applikasjonen

Bygg Electron applikasjonen ved å bruke denne kommandoen:

På Windows:

```bash
yarn build:win
```

På Linux:

```bash
yarn build:linux
```

## Bidragsytere

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## Lisens

Hydra bruker [MIT Lisensen](LICENSE).
