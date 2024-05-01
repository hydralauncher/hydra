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

You'll need a SteamGridDB API Key in order to fetch the game icons on installation.
If you want to have onlinefix as a repacker you'll need to add your credentials to the .env

Once you have it, you can paste the `.env.example` file and put it on `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

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

<!-- readme: contributors -start -->
<table>
<tr>
    <td align="center">
        <a href="https://github.com/hydralauncher">
            <img src="https://avatars.githubusercontent.com/u/164102380?v=4" width="100;" alt="hydralauncher"/>
            <br />
            <sub><b>Hydra</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/zamitto">
            <img src="https://avatars.githubusercontent.com/u/167933696?v=4" width="100;" alt="zamitto"/>
            <br />
            <sub><b>Null</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/fzanutto">
            <img src="https://avatars.githubusercontent.com/u/15229294?v=4" width="100;" alt="fzanutto"/>
            <br />
            <sub><b>Null</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/JackEnx">
            <img src="https://avatars.githubusercontent.com/u/167036558?v=4" width="100;" alt="JackEnx"/>
            <br />
            <sub><b>Null</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/lilezek">
            <img src="https://avatars.githubusercontent.com/u/2767229?v=4" width="100;" alt="lilezek"/>
            <br />
            <sub><b>Null</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Magrid0">
            <img src="https://avatars.githubusercontent.com/u/73496008?v=4" width="100;" alt="Magrid0"/>
            <br />
            <sub><b>Magrid</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/fhilipecrash">
            <img src="https://avatars.githubusercontent.com/u/36455575?v=4" width="100;" alt="fhilipecrash"/>
            <br />
            <sub><b>Fhilipe Coelho</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/ferivoq">
            <img src="https://avatars.githubusercontent.com/u/36544651?v=4" width="100;" alt="ferivoq"/>
            <br />
            <sub><b>FeriVOQ</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/xbozo">
            <img src="https://avatars.githubusercontent.com/u/119091492?v=4" width="100;" alt="xbozo"/>
            <br />
            <sub><b>Guilherme Viana</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/pmenta">
            <img src="https://avatars.githubusercontent.com/u/71457671?v=4" width="100;" alt="pmenta"/>
            <br />
            <sub><b>João Martins</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/eltociear">
            <img src="https://avatars.githubusercontent.com/u/22633385?v=4" width="100;" alt="eltociear"/>
            <br />
            <sub><b>Ikko Eltociear Ashimine</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Netflixyapp">
            <img src="https://avatars.githubusercontent.com/u/91623880?v=4" width="100;" alt="Netflixyapp"/>
            <br />
            <sub><b>Netflixy</b></sub>
        </a>
    </td></tr>
</table>
<!-- readme: contributors -end -->

## License

Hydra is licensed under the [MIT License](LICENSE).
