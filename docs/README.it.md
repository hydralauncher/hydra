<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>
  
  <p align="center">
    <strong>Hydra è un game launcher con il proprio client bittorrent.</strong>
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
[![da](https://img.shields.io/badge/lang-da-red)](README.da.md)
[![nb](https://img.shields.io/badge/lang-nb-blue)](README.nb.md)
[![et](https://img.shields.io/badge/lang-et-blue.svg)](README.et.md)

![Hydra Catalogue](./screenshot.png)

</div>

## Table of Contents

- [Table of Contents](#table-of-contents)
- [A proposito](#a-proposito)
- [Caratteristiche](#caratteristiche)
- [Installazione](#installazione)
- [Contribuire](#-contribuire)
  - [Unisciti su Telegram](#-unisciti-su-telegram)
  - [Forka e Clona la repository](#forka-e-clona-la-repository)
  - [Modi in cui contribuire](#modi-in-cui-contribuire)
  - [Struttura del Progetto](#struttura-del-progetto)
- [Compilazione](#compilazione)
  - [Installa Node.js](#installa-nodejs)
  - [Installa Yarn](#installa-yarn)
  - [Installa le dipendenze Node](#installa-le-dipendenze-node)
  - [Installa Python 3.9](#installa-python-39)
  - [Installa le Dipendenze Python](#installa-le-dipendenze-python)
- [Variabili d'ambiente](#variabili-dambiente)
- [Esecuzione](#esecuzione)
- [Compilazione](#compilazione-1)
  - [Compila il bittorrent](#compila-il-bittorrent)
  - [Compila l'applicazione Electron](#compila-lapplicazione-electron)
- [Collaboratori](#collaboratori)
- [Licenza](#licenza)

## A proposito

**Hydra** è un **Game Launcher** con il proprio **Client BitTorrent**.
<br>
Il launcher è scritto in TypeScript (Electron) and Python, che gestisce il sistema di torrenting appoggiandosi a libtorrent.

## Caratteristiche

- Client Bittorrent integrato
- Integrazione How Long To Beat (HLTB) nella pagina del gioco
- Percorso del download Personalizzato
- Supporto Windows e Linux
- Costantemente Aggiornato
- E molto altro ...

## Installazione

Segui i seguenti passi:

1. Scarica l'ultima versione di Hydra dalla pagina [Releases](https://github.com/hydralauncher/hydra/releases/latest).
   - Scarica solo il file .exe per installare Hydra su Windows.
   - Scarica il file .deb o .rpm o .zip per Linux. (Dipende dalla tua distro Linux)
2. Esegui il file scaricato.
3. Goditi Hydra!

## <a name="contribuire"> Contribuire

### <a name="unisciti-su-telegram"></a> Unisciti su Telegram

Puoi unirti alle nostre conversazioni sul canale [Telegram](https://t.me/hydralauncher).

### Forka e Clona la repository

1. Forka la repository [(clicca qui per forkare)](https://github.com/hydralauncher/hydra/fork)
2. Clona il tuo codice forkato `git clone https://github.com/your_username/hydra`
3. Crea un nuovo branch
4. Aggiungi le modifiche (push)
5. Invia la richiesta di pull

### Modi in cui contribuire

- Traduzione: Vogliamo rendere Hydra disponibile a più persone possibile. Sentiti libero di tradurre in altre lingue o aggiornare e migliorare quelle già disponibili su Hydra.
- Programmazione: Hydra è programmato in TypeScript, Electron e un po' di Python. Se intendi contribuire unisciti al nostro [Telegram](https://t.me/hydralauncher)!

### Struttura del Progetto

- client-torrent: Usiamo libtorrent, una libreria Python, per gestire i download dei torrent
- src/renderer: l'UI dell'applicazione
- src/main: tutta la logica qui.

## Compilazione

### Installa Node.js

Assicurati di avere Node.js installato sulla tua macchina. Scaricalo e installalo da [nodejs.org](https://nodejs.org/).

### Installa Yarn

Yarn è un gestore di pacchetti per Node.js. Se non hai ancora installato Yarn segui le istruzioni su [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Installa le dipendenze Node

Naviga alla cartella del progetto e installa le dipendenze Node con Yarn:

```bash
cd hydra
yarn
```

### Installa Python 3.9

Assicurati di avere Python 3.9 installato. Puoi scaricarlo da [python.org](https://www.python.org/downloads/release/python-3913/).

### Installa le Dipendenze Python

Installa le dipendenze con pip:

```bash
pip install -r requirements.txt
```

## Variabili d'ambiente

Avrai bisogno di una chiave API SteamGridDB per poter caricare le icone di gioco.

Una volta ottenuta, puoi copiare e rinominare il file `.env.example` a `.env` e metterlo in `STEAMGRIDDB_API_KEY`.

## Esecuzione

Una volta impostato tutto, puoi eseguire il seguente comando per avviare il processo Electron e il client bittorrent:

```bash
yarn dev
```

## Compilazione

### Compila il bittorrent

Usa il comando:

```bash
python torrent-client/setup.py build
```

### Compila l'applicazione Electron

Usa il comando:

Per Windows:

```bash
yarn build:win
```

Per Linux:

```bash
yarn build:linux
```

## Collaboratori

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## Licenza

Hydra è concesso in licenza secondo la [MIT License](LICENSE).
