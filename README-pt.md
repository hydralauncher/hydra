[Read-me in English](./README.md) (Leia-me em Inglês)

# Hydra

<a href="https://discord.gg/hydralauncher" target="_blank">![Discord](https://img.shields.io/discord/1220692017311645737?style=flat&logo=discord&label=Hydra&labelColor=%231c1c1c)</a>
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)
![GitHub package.json version](https://img.shields.io/github/package-json/v/hydralauncher/hydra)

Hydra é um inicializador de jogos com seu próprio cliente bittorrent integrado e um scraper de repack autogerenciado.
O inicializador é escrito em TypeScript (Electron) e Python, que lida com o sistema de torrents usando [libtorrent](https://www.libtorrent.org/).

![Catálogo Hydra](./docs/screenshot.png)

## Instalação

### Instale o Node.js

Certifique-se de ter o Node.js instalado em sua máquina. Caso contrário, baixe e instale-o em [nodejs.org](https://nodejs.org/).

### Instale o Yarn

Yarn é um gerenciador de pacotes para o Node.js. Se você ainda não instalou o Yarn, você pode fazê-lo seguindo as instruções em [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/) (em Inglês).

### Clone o repositório

```bash
git clone https://github.com/hydralauncher/hydra.git
```

### Instale as Dependências do Node

Navegue até o diretório do projeto e instale as dependências do Node usando o Yarn:

```bash
cd hydra
yarn
```

### Instale o Python 3.9

Certifique-se de ter o Python instalado em sua máquina. Você pode baixá-lo e instalá-lo em [python.org](https://www.python.org/downloads/release/python-3919/).

### Instalar as Dependências do Python

Instale as dependências necessárias do Python usando o pip:

```bash
pip install -r requirements.txt
```

## Variáveis de ambiente

Você precisará de uma chave de API do SteamGridGB para buscar os ícones de jogo na instalação.
Se você deseja ter o onlinefix como repacker, você precisará adicionar suas credenciais no .env

Depois de obtê-lo, você pode colar o arquivo `.env.example` e preencher os campos `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Executando

Depois de configurar tudo, você pode executar o seguinte comando para iniciar o processo Electron e o cliente bittorrent:

```bash
yarn start
```

## Compilação

### Construa o cliente bittorrent

Construa o cliente bittorrent usando este comando:

```bash
python torrent-client/setup.py build
```

### Construa a aplicação Electron

Construa a aplicação Electron usando este comando:

```bash
yarn make
```

## Contribuidores

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

Feito com [contrib.rocks](https://contrib.rocks).

## Licença

Hydra é licenciada sob a [Licença MIT](LICENSE).
