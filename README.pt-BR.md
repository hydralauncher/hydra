<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>
  
  <p align="center">
    <strong>Hydra é um Launcher de Jogos com seu próprio cliente de bittorrent integrado e um wrapper autogerenciado para busca de repacks.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

[![be](https://img.shields.io/badge/lang-be-orange)](README.be.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![pl](https://img.shields.io/badge/lang-pl-white)](README.pl.md)
[![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)
[![uk-UA](https://img.shields.io/badge/lang-uk--UA-blue)](README.uk-UA.md)
![Hydra Catalogue](./docs/screenshot.png)

</div>

## Índice

- [Sobre](#about)
- [Recursos](#features)
- [Instalação](#installation)
- [Contribuindo](#contributing)
  - [Junte-se ao nosso Telegram](#join-our-telegram)
  - [Fork e clone seu repositorio](#fork-and-clone-your-repository)
  - [Como contribuir](#ways-you-can-contribute)
  - [Estrutura do projeto](#project-structure)
- [Compile a partir do código-fonte](#build-from-source)
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

## <a name="about"> Sobre

**Hydra** é um **Launcher de Jogos** com seu próprio **Cliente BitTorrent incorporado** e um **raspador de repack auto-gerenciado**.
<br>
O launcher é escrito em TypeScript (Electron) e Python, que lida com o sistema de torrent usando libtorrent.

## <a name="features"> Recursos

- Wrapper de repacks auto-gerenciado entre todos os sites mais confiáveis no [Megathread]("https://www.reddit.com/r/Piracy/wiki/megathread/")
- Cliente BitTorrent incorporado próprio
- Integração com [How Long To Beat (HLTB)](https://howlongtobeat.com/) na página do jogo
- Personalização do caminho de downloads
- Notificações de atualização da lista de repacks
- Suporte para Windows e Linux
- Constantemente atualizado
- E mais ...

## <a name="installation"> Instalação

Siga os passos abaixo para instalar:

1. Baixe a versão mais recente do Hydra na página de [Releases](https://github.com/hydralauncher/hydra/releases/latest).
   - Baixe apenas o .exe se quiser instalar o Hydra no Windows.
   - Baixe .deb ou .rpm ou .zip se quiser instalar o Hydra no Linux. (depende da sua distribuição Linux)
2. Execute o arquivo baixado.
3. Aproveite o Hydra!

## <a name="contributing"> Contribuindo

### <a name="join-our-telegram"></a> Junte-se ao nosso Telegram

Concentramos nossas discussões no nosso canal do [Telegram](https://t.me/hydralauncher).

### <a name="fork-and-clone-your-repository"></a> Fork e clone o seu repositório

1. Faça um fork do repositório [(clique aqui para fazer o fork agora)](https://github.com/hydralauncher/hydra/fork)
2. Clone o código do seu fork `git clone https://github.com/seu_nome_de_usuário/hydra`
3. Crie uma nova branch
4. Faça o push dos seus commits
5. Envie um novo Pull Request

### <a name="ways-you-can-contribute"></a> Formas de contribuir

- **Tradução**: Queremos que o Hydra esteja disponível para o maior número possível de pessoas. Sinta-se à vontade para ajudar a traduzir para novos idiomas ou atualizar e melhorar aqueles que já estão disponíveis no Hydra.
- **Código**: O Hydra é construído com Typescript, Electron e um pouco de Python. Se você deseja contribuir, junte-se ao nosso [Telegram](https://t.me/hydralauncher)!

### <a name="project-structure"></a> Estrutura do Projeto

- torrent-client: Utilizamos o libtorrent, uma biblioteca Python, para gerenciar downloads via torrent.
- src/renderer: A interface de usuário (UI) da aplicação.
- src/main: Toda a lógica da aplicação reside aqui.

## <a name="build-from-source"></a> Compile a partir do código-fonte

### <a name="install-nodejs"></a> Instale Node.js

Certifique-se de ter o Node.js instalado em sua máquina. Se não, faça o download e instale-o em [nodejs.org](https://nodejs.org/).

### <a name="install-yarn"></a> Instale Yarn

Yarn é um gerenciador de pacotes para Node.js. Se você ainda não o instalou, pode fazê-lo seguindo as instruções em [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### <a name="install-node-dependencies"></a> Instale Dependencias do Node

Navegue até o diretório do projeto e instale as dependências do Node usando o Yarn:

```bash
cd hydra
yarn
```

### <a name="install-python-39"></a> Instale Python 3.9

Certifique-se de ter o Python 3.9 instalado em sua máquina. Você pode baixá-lo e instalá-lo em [python.org](https://www.python.org/downloads/release/python-3913/).

### <a name="install-python-dependencies"></a> Instale Python Dependencies

Instale as dependências Python necessárias usando o pip:

```bash
pip install -r requirements.txt
```

## <a name="environment-variables"></a> Environment variables

Você precisará de uma chave da API SteamGridDB para buscar os ícones do jogo durante a instalação.
Se você deseja ter o onlinefix como um repacker, precisará adicionar suas credenciais ao arquivo .env.

Depois de obtê-lo, você pode copiar ou renomear o arquivo `.env.example` para `.env` e inserir `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME` e `ONLINEFIX_PASSWORD`.

## <a name="running"></a> Running

Uma vez que você tenha configurado tudo, você pode executar o seguinte comando para iniciar tanto o processo Electron quanto o cliente BitTorrent:

```bash
yarn dev
```

## <a name="build"></a> Build

### <a name="build-the-bittorrent-client"></a> Build the bittorrent client

Compile o cliente BitTorrent usando este comando

```bash
python torrent-client/setup.py build
```

### <a name="build-the-electron-application"></a> Build the Electron application

Compile a aplicação Electron usando este comando:

No Windows:

```bash
yarn build:win
```

No Linux:

```bash
yarn build:linux
```

## <a name="contributors"></a> Contributors

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## <a name="license"></a> Licença

O Hydra é licenciado sob a [Licença MIT](LICENSE).
