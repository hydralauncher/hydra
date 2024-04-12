# Hydra

Hydra is a game launcher with its own embedded bittorrent client and a self-managed repack scraper.
The launcher is written in TypeScript (Electron) and Python, which handles the torrenting system by using [libtorrent](https://www.libtorrent.org/).

![Hydra Catalogue](./docs/screenshot.png)

## Installation

### Install Node.js

Ensure you have Node.js installed on your machine. If not, download and install it from [nodejs.org](nodejs.org).

### Install Yarn

Yarn is a package manager for Node.js. If you haven't installed Yarn yet, you can do so by following the instructions on [yarnpkg.com](yarnpkg.com).

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

Ensure you have Python installed on your machine. You can download and install it from [python.org](python.org).

### Install Python Dependencies

Install the required Python dependencies using pip:

```bash
pip install -r requirements.txt
```

## Environment variables

You'll need an SteamGridDB API Key in order to fetch the game icons on installation.
If you want to have onlinefix as a repacker you'll need to add your credentials to the .env

Once you have it, you can paste the `.env.example` file and put it on `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Running

Once you've installed all dependencies, you can build and run Hydra Download Manager. Here are the basic commands:

## Build

### Build the bittorrent client

Build the bittorrent client by using this command:

```bash
pyinstaller torrent-client/main.py --distpath resources/dist --icon=images/icon.ico -n hydra-download-manager
```

### Build the Electron application

Build the Electron application by using this command:

```bash
yarn make
```

## License

Hydra is licensed under the [MIT License](LICENSE).
