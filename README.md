<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra is a game launcher with its own embedded bittorrent client.</strong>
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

![Hydra Catalogue](./docs/screenshot.png)

</div>

## Table of Contents

- [Table of Contents](#table-of-contents)
- [About](#about)
- [Features](#features)
- [Installation](#installation)
- [Contributing](#-contributing)
  - [Join our Telegram](#-join-our-telegram)
  - [Fork and clone your repository](#fork-and-clone-your-repository)
  - [Ways you can contribute](#ways-you-can-contribute)
  - [Project Structure](#project-structure)
- [Build from source](#build-from-source)
  - [Install Node.js](#install-nodejs)
  - [Install Yarn](#install-yarn)
  - [Install Node Dependencies](#install-node-dependencies)
  - [Install Python 3.9](#install-python-39)
  - [Install Python Dependencies](#install-python-dependencies)
- [Environment variables](#environment-variables)
- [Running](#running)
- [Build](#build)
  - [Build the bittorrent client](#build-the-bittorrent-client)
  - [Build the Electron application](#build-the-electron-application)
- [Contributors](#contributors)
- [License](#license)

## About

**Hydra** is a **Game Launcher** with its own embedded **BitTorrent Client**.
<br>
The launcher is written in TypeScript (Electron) and Python, which handles the torrenting system by using libtorrent.

## Features

- Own embedded bittorrent client
- How Long To Beat (HLTB) integration on game page
- Downloads path customization
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

## <a name="contributing"> Contributing

### <a name="join-our-telegram"></a> Join our Telegram

We concentrate our discussions on our [Telegram](https://t.me/hydralauncher) channel.

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

Ensure you have Python 3.9 installed on your machine. You can download and install it from [python.org](https://www.python.org/downloads/release/python-3913/).

### Install Python Dependencies

Install the required Python dependencies using pip:

```bash
pip install -r requirements.txt
```

## Environment variables

You'll need an SteamGridDB API Key in order to fetch the game icons on installation.

Once you have it, you can copy or rename the `.env.example` file to `.env` and put it on`STEAMGRIDDB_API_KEY`.

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
