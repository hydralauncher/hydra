<br>

<div align="center">

  [<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>
  
  <p align="center">
    <strong>Hydra é um Game Launcher com seu próprio cliente de bittorrent integrado e um wrapper autogerenciado para busca de repacks.</strong>
  </p>

  [![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
  [![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

  [![pt-BR](https://img.shields.io/badge/lang-pt--br-green.svg)](README.pt-BR.md)
  [![en](https://img.shields.io/badge/lang-en-red.svg)](README.md)
  [![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)
  [![uk-UA](https://img.shields.io/badge/lang-ua-blue)](README.uk-UA.md)

  ![Hydra Catalogue](./docs/screenshot.png)

</div>

## Índice

- [Sobre](#about)
- [Recursos](#features)
- [Instalação](#installation)
- [Contributing](#contributing)
  - [Junte-se ao nosso Telegram](#join-our-telegram)
  - [Fork e clone seu repositorio](#fork-and-clone-your-repository)
  - [Como contribuir](#ways-you-can-contribute)
  - [Estrutura do projeto](#project-structure)
- [Compile a partir do codigo fonte](#build-from-source)
  - [Instale Node.js](#install-nodejs)
  - [Instale Yarn](#install-yarn)
  - [Instale Node Dependencies](#install-node-dependencies)
  - [Instale Python 3.9](#install-python-39)
  - [Instale Python Dependencies](#install-python-dependencies)
- [variaveis de ambiente](#environment-variables)
- [Rodando o programa](#running)
- [Compilando](#build)
  - [Compile o client bittorrent](#build-the-bittorrent-client)
  - [Compile a aplicação Electron](#build-the-electron-application)
- [Contribuidores](#contributors)

## About

**Hydra** is a **Game Launcher** with its own embedded **BitTorrent Client** and a **self-managed repack scraper**.
<br>
The launcher is written in TypeScript (Electron) and Python, which handles the torrenting system by using libtorrent.

## Features

- Self-Managed repack scraper among all the most reliable websites on the [Megathread]("https://www.reddit.com/r/Piracy/wiki/megathread/")
- Own embedded bittorrent client
- How Long To Beat (HLTB) integration on game page
- Downloads path customization
- Repack list update notifications
- Windows and Linux support
- Constantly updated
- And more ...

## Installation

Follow the steps below to install:

1. Download the latest version of Hydra from the [Releases](https://github.com/hydralauncher/hydra/releases/latest) page.
   - Download only .exe if you want to install Hydra on Windows.
   - Download .deb or .rpm or .zip if you want to install Hydra on Linux. (depends on your Linux distro)
2. Run the downloaded file.
3. Enjoy Hydra!

## <a name="contributing"> Contribuindo

### <a name="join-our-telegram"></a> Junte-se ao nosso Telegram

Concentramos nossas discussões no nosso canal do [Telegram](https://t.me/hydralauncher).

### Fork and clone your repository

1. Fork the repository [(click here to fork now)](https://github.com/hydralauncher/hydra/fork)
2. Clone your forked code `git clone https://github.com/your_username/hydra`
3. Create a new branch
4. Push your commits
5. Submit a new Pull Request

### Ways you can contribute

- Translation: We want Hydra to be available to as many people as possible. Feel free to help translate to new languages or update and improve the ones that are already available on Hydra.
- Code: Hydra is built with Typescript, Electron and a little bit of Python. If you want to contribute, join our [Telegram](https://t.me/hydralauncher)!

### Project Structure

- torrent-client: We use libtorrent, a Python library, to manage torrent downloads
- src/renderer: the UI of the application
- src/main: all the logic rests here.

## Build from source

### Install Node.js

Ensure you have Node.js installed on your machine. If not, download and install it from [nodejs.org](https://nodejs.org/).

### Install Yarn

Yarn is a package manager for Node.js. If you haven't installed Yarn yet, you can do so by following the instructions on [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Install Node Dependencies

Navigate to the project directory and install the Node dependencies using Yarn:

```bash
cd hydra
yarn
```

### Install Python 3.9

Ensure you have Python 3.9 installed on your machine. You can download and install it from [python.org](https://www.python.org/downloads/release/python-3919/).

### Install Python Dependencies

Install the required Python dependencies using pip:

```bash
pip install -r requirements.txt
```

## Environment variables

You'll need an SteamGridDB API Key in order to fetch the game icons on installation.
If you want to have onlinefix as a repacker you'll need to add your credentials to the .env

Once you have it, you can copy or rename the `.env.example` file to `.env`and put it on`STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Running

Once you've got all things set up, you can run the following command to start both the Electron process and the bittorrent client:

```bash
yarn dev
```

## Build

### Build the bittorrent client

Build the bittorrent client by using this command:

```bash
python torrent-client/setup.py build
```

### Build the Electron application

Build the Electron application by using this command:

On Windows:

```bash
yarn build:win
```

On Linux:

```bash
yarn build:linux
```

## Contributors

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## License

Hydra is licensed under the [MIT License](LICENSE).
