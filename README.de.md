<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra ist ein Launcher für Spiele mit einem eigenen eingebetteten BitTorrent-Client.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

[![en](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![be](https://img.shields.io/badge/lang-be-orange)](README.be.md)
[![pl](https://img.shields.io/badge/lang-pl-white)](README.pl.md)
[![pt-BR](https://img.shields.io/badge/lang-pt--BR-green.svg)](README.pt-BR.md)
[![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)
[![uk-UA](https://img.shields.io/badge/lang-uk--UA-blue)](README.uk-UA.md)
[![es](https://img.shields.io/badge/lang-es-red)](README.es.md)
[![fr](https://img.shields.io/badge/lang-fr-blue)](README.fr.md)
[![de](https://img.shields.io/badge/lang-de-black)](README.de.md)
[![cs](https://img.shields.io/badge/lang-cs-purple)](README.cs.md)
[![da](https://img.shields.io/badge/lang-da-red)](README.da.md)

![Hydra Katalog](./docs/screenshot.png)

</div>

## Inhaltsverzeichnis

- [Über Hydra](#über-hydra)
- [Eigenschaften](#eigenschaften)
- [Installation](#installation)
- [Mitwirken](#mitwirken)
  - [Tritt uns auf Telegram bei](#tritt-uns-auf-telegram-bei)
  - [Forke und klone dein Repo](#forke-und-klone-dein-repo)
  - [Wie du mitwirken kannst](#wie-du-mitwirken-kannst)
  - [Projektstruktur](#projektstruktur)
- [Den Quellcode kompilieren](#den-quellcode-kompilieren)
  - [Installiere Node.js](#installiere-nodejs)
  - [Installiere Yarn](#installiere-yarn)
  - [Installiere Node-Abhängigkeiten](#installiere-node-abhängigkeiten)
  - [Installiere Python 3.9](#installiere-python-39)
  - [Installiere Python-Abhängigkeiten](#installiere-python-abhängigkeiten)
- [Umgebungsvariablen](#umgebungsvariablen)
- [Ausführung](#ausführung)
- [Kompilation](#kompilation)
  - [Kompiliere den BitTorrent-Client](#kompiliere-den-bittorrent-client)
  - [Kompiliere die Electron-Applikation](#kompiliere-die-electron-applikation)
- [Mitwirkende](#mitwirkende)

## Über Hydra

**Hydra** ist ein **Launcher für Spiele** mit einem eigenen eingebetteten **BitTorrent-Client**.
<br>
Der Launcher ist in TypeScript (Electron) und Python, womit das Torrentingsystem durch Einsatz von libtorrent geregelt ist, geschrieben.

## Eigenschaften

- Eigener eingebetteter BitTorrent-Client
- How Long to Beat (HLTB) Integration auf der Spielseite
- Anpassbarkeit des Downloadverzeichnisses
- Unterstützung von Windows und Linux
- Regelmäßig aktualisiert
- Und mehr ...

## Installation

Die folgenden Schritte beschreiben den Installationsprozess:

1. Lade die neueste Version von Hydra von der [Releases](https://github.com/hydralauncher/hydra/releases/latest) Seite herunter.
   - Für die Installation von Hydra auf Windows, wähle die .exe Datei.
   - Für die Installation von Hydra auf Linux, wähle die .deb, .rpm oder .zip Datei. (Abhängig von deiner Linux-Distribution)
2. Führe die heruntergeladene Datei aus.
3. Genieße Hydra!

## Mitwirken

### Tritt uns auf Telegram bei

Wir konzentrieren unsere Diskussionen in unserem [Telegram](https://t.me/hydralauncher) Kanal.

### Forke und klone dein Repo

1. Forke das Repo [(Klicke hier, um direkt zu forken)](https://github.com/hydralauncher/hydra/fork)
2. Klone deinen geforketen Code `git clone https://github.com/dein_nutzername/hydra`
3. Erstelle einen neuen Branch
4. Pushe deine Commits
5. Stelle eine neue Pull-Anfrage

### Wie du mitwirken kannst

- Übersetzung: Wir wollen Hydra so vielen Menschen wie möglich zugänglich machen. Gerne kannst du uns helfen neue Sprachen zu übersetzen oder für Hydra bereits verfügbare Sprachen zu aktualisieren und verbessern.
- Code: Hydra ist mit TypeScript, Electron und etwas Python gebaut. Wenn du mitwirken möchtest, tritt unserem [Telegram](https://t.me/hydralauncher) bei!

### Projektstruktur

- torrent-client: Wir verwenden die Python-Bibliothek libtorrent zur Verwaltung von Torrent-Downloads.
- src/renderer: die UI der Applikation.
- src/main: sämtliche Logik liegt hier.

## Den Quellcode kompilieren

### Installiere Node.js

Stelle sicher, dass du Node.js auf deinem System installiert hast. Falls nicht, installiere es von [nodejs.org](https://nodejs.org/).

### Installiere Yarn

Yarn ist ein Packetmanager für Node.js. Sollte er dir fehlen, installiere ihn mithilfe der Anleitung auf [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Installiere Node-Abhängigkeiten

Navigiere zum Projektverzeichnis und installiere die Node-Abhängigkeiten mit Yarn:

```bash
cd hydra
yarn
```

### Installiere Python 3.9

Stelle sicher, dass du Python 3.9 auf deinem System installiert hast. Ansonsten kannst du es von [python.org](https://www.python.org/downloads/release/python-3913/) herunterladen und installieren.

### Installiere Python-Abhängigkeiten

Installiere die benötigten Python-Abhängigkeiten mit pip:

```bash
pip install -r requirements.txt
```

## Umgebungsvariablen

Du wirst einen SteamGridDB API Schlüssel benötigen, um die Spielicons bei Installation abzurufen.

Sobald du einen hast, kannst du die .env.example Datei zu .env kopieren oder umbenennen und den Schlüssel bei STEAMGRIDDB_API_KEY einfügen.

## Ausführung

Sobald du alles eingerichtet hast, kannst du den folgenden Befehl nutzen, um sowohl den Electron-Prozess als auch den BitTorrent-Client zu starten:

```bash
yarn dev
```

## Kompilation

### Kompiliere den BitTorrent-Client

Kompiliere den BitTorrent-Client mit folgendem Befehl:

```bash
python torrent-client/setup.py build
```

### Kompiliere die Electron-Applikation

Kompiliere die Electron-Applikation mit folgendem Befehl:

Auf Windows:

```bash
yarn build:win
```

Auf Linux:

```bash
yarn build:linux
```

## Mitwirkende

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## Lizenz

Hydra ist unter der [MIT Lizenz](LICENSE) lizensiert.
