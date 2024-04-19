# Hydra

<a href="https://discord.gg/hydralauncher" target="_blank">![Discord](https://img.shields.io/discord/1220692017311645737?style=flat&logo=discord&label=Hydra&labelColor=%231c1c1c)</a>
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)
![GitHub package.json version](https://img.shields.io/github/package-json/v/hydralauncher/hydra)

Hydra is a game launcher with its own embedded bittorrent client and a self-managed repack scraper.
The launcher is written in TypeScript (Electron) and Python, which handles the torrenting system by using [libtorrent](https://www.libtorrent.org/).

![Hydra Catalogue](./docs/screenshot.png)

## Installation

### Install Node.js

Ensure you have Node.js installed on your machine. If not, download and install it from [nodejs.org](https://nodejs.org/).

### Install Yarn

Yarn is a package manager for Node.js. If you haven't installed Yarn yet, you can do so by following the instructions on [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Clone the Repository

```bash
git clone https://github.com/hydralauncher/hydra.git
```

### Install Node Dependencies

Navigate to the project directory and install the Node dependencies using Yarn:

```bash
cd hydra
yarn
```

### Install Python 3.9

Ensure you have Python installed on your machine. You can download and install it from [python.org](https://www.python.org/downloads/release/python-3919/).

### Install Python Dependencies

Install the required Python dependencies using pip:

```bash
pip install -r requirements.txt
```

## Environment variables

You'll need an SteamGridDB API Key in order to fetch the game icons on installation.
Once you have it, you can paste the `.env.example` file and put it on `STEAMGRIDDB_API_KEY`.

## Running

Once you've got all things set up, you can run the following command to start both the Electron process and the bittorrent client:

```bash
yarn start
```

## Build

### Build the bittorrent client

Build the bittorrent client by using this command:

```bash
python torrent-client/setup.py build
```

### Build the Electron application

Build the Electron application by using this command:

```bash
yarn make
```

## Contributors

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

## License

Hydra is licensed under the [MIT License](LICENSE).
