<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra est un lanceur de jeux avec son propre client bittorrent intégré et un scraper de repack auto-géré.</strong>
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
[![de](https://img.shields.io/badge/lang-de-black)](README.de.md)

![Catalogue Hydra](./docs/screenshot.png)

</div>

## Table des Matières

- [À propos](#à-propos)
- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Contribuer](#contribuer)
  - [Rejoindre notre Telegram](#rejoindre-notre-telegram)
  - [Fork et Cloner votre dépôt](#fork-et-cloner-votre-dépôt)
  - [Manières de contribuer](#manières-de-contribuer)
  - [Structure du projet](#structure-du-projet)
- [Compiler depuis les sources](#compiler-depuis-les-sources)
  - [Installer Node.js](#installer-nodejs)
  - [Installer Yarn](#installer-yarn)
  - [Installer les dépendances Node](#installer-les-dépendances-node)
  - [Installer Python 3.9](#installer-python-39)
  - [Installer les dépendances Python](#installer-les-dépendances-python)
- [Variables d'environnement](#variables-denvironnement)
- [Lancement](#lancement)
- [Compilation](#compilation)
  - [Compiler le client bittorrent](#compiler-le-client-bittorrent)
  - [Compiler l'application Electron](#compiler-lapplication-electron)
- [Contributeurs](#contributeurs)

## À propos

**Hydra** est un **lanceur de jeux** avec son propre **client BitTorrent** intégré et un **scraper de repack auto-géré**.
<br>
Le lanceur est écrit en TypeScript (Electron) et Python, qui gère le système de torrent en utilisant libtorrent.

## Fonctionnalités

- Scraper de repack auto-géré parmi tous les sites les plus fiables sur le [Megathread]("https://www.reddit.com/r/Piracy/wiki/megathread/")
- Client bittorrent intégré
- Intégration How Long To Beat (HLTB) sur la page du jeu
- Personnalisation des chemins de téléchargement
- Notifications de mise à jour de la liste de repack
- Support pour Windows et Linux
- Constamment mis à jour
- Et plus encore ...

## Installation

Suivez les étapes ci-dessous pour installer :

1. Téléchargez la dernière version de Hydra depuis la page [Releases](https://github.com/hydralauncher/hydra/releases/latest).
   - Téléchargez uniquement le .exe si vous voulez installer Hydra sur Windows.
   - Téléchargez .deb ou .rpm ou .zip si vous voulez installer Hydra sur Linux (cela dépend de votre distribution Linux).
2. Exécutez le fichier téléchargé.
3. Profitez de Hydra !

## Contribuer

### Rejoindre notre Telegram

Nous concentrons nos discussions sur notre [Telegram](https://t.me/hydralauncher).

### Fork et Cloner votre dépôt

1. Forkez le dépôt [(cliquez ici pour forker maintenant)](https://github.com/hydralauncher/hydra/fork)
2. Clonez votre code forké `git clone https://github.com/votre_nom_utilisateur/hydra`
3. Créez une nouvelle branche
4. Pushez vos commits
5. Créez une nouvelle Pull Request

### Manières de contribuer

- Traduction : Nous voulons que Hydra soit disponible pour le plus grand nombre de personnes possible. N'hésitez pas à aider à traduire dans de nouvelles langues ou à mettre à jour et améliorer celles qui sont déjà disponibles sur Hydra.
- Code : Hydra est construit avec Typescript, Electron et un peu de Python. Si vous voulez contribuer, rejoignez notre [Telegram](https://t.me/hydralauncher) !

### Structure du projet

- torrent-client : Nous utilisons libtorrent, une bibliothèque Python, pour gérer les téléchargements torrent.
- src/renderer : l'interface utilisateur de l'application.
- src/main : toute la logique repose ici.

## Compiler depuis les sources

### Installer Node.js

Assurez-vous que Node.js est installé sur votre machine. Sinon, téléchargez et installez-le depuis [nodejs.org](https://nodejs.org/).

### Installer Yarn

Yarn est un gestionnaire de paquets pour Node.js. Si vous n'avez pas encore installé Yarn, vous pouvez le faire en suivant les instructions sur [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Installer les dépendances Node

Naviguez vers le répertoire du projet et installez les dépendances Node en utilisant Yarn :

```bash
cd hydra
yarn
```

### Installer Python 3.9

Assurez-vous que Python 3.9 est installé sur votre machine. Vous pouvez le télécharger et l'installer depuis [python.org](https://www.python.org/downloads/release/python-3913/).

### Installer les dépendances Python

Installez les dépendances Python requises en utilisant pip :

```bash
pip install -r requirements.txt
```

## Variables d'environnement

Vous aurez besoin d'une clé API SteamGridDB pour récupérer les icônes de jeux lors de l'installation.
Si vous voulez avoir onlinefix comme repacker, vous devrez ajouter vos identifiants au fichier .env.

Une fois que vous l'avez, vous pouvez copier ou renommer le fichier `.env.example` en `.env` et y mettre `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Lancement

Une fois que vous avez tout configuré, vous pouvez exécuter la commande suivante pour démarrer à la fois le processus Electron et le client bittorrent :

```bash
yarn dev
```

## Compilation

### Compiler le client bittorrent

Compilez le client bittorrent en utilisant cette commande :

```bash
python torrent-client/setup.py build
```

### Compiler l'application Electron

Compilez l'application Electron en utilisant cette commande :

Sur Windows :

```bash
yarn build:win
```

Sur Linux :

```bash
yarn build:linux
```

## Contributeurs

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## License

Hydra est sous [License MIT](LICENSE).
