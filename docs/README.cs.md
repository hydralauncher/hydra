<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra je herní launcher s vlastním vestavěným Bittorrent klientem.</strong>
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

![Hydra Katalog](./screenshot.png)

</div>

## Seznam obsahu

- [Seznam obsahu](#seznam-obsahu)
- [O projektu](#o-projektu)
- [Funkce](#funkce)
- [Instalace](#instalace)
- [Přispívání](#přispívání)
  - [Připoj se na náš telegram](#připoj-se-na-náš-telegram)
  - [Vytvořte fork a naklonujte svůj repozitář](#vytvořte-fork-a-naklonujte-svůj-repozitář)
  - [Způsoby jak můžete přispět](#způsoby-jak-můžete-přispět)
  - [Struktura projektu](#struktura-projektu)
- [Sestavení ze zdroje](#sestavení-ze-zdroje)
  - [Instalace Node.js](#instalace-nodejs)
  - [Instalace Yarn](#instalace-yarn)
  - [Instalace Požadavků pro Node.js](#instalace-požadavků-pro-nodejs)
  - [Instalace Pythonu 3.9](#instalace-pythonu-39)
  - [Instalace Požadavků pro Python](#instalace-požadavků-pro-python)
- [Proměnné prostředí](#proměnné-prostředí)
- [Spuštění](#spuštění)
- [Sestavení](#sestavení)
  - [Sestavení bittorrent klientu](#sestavení-bittorrent-klientu)
  - [Sestavení electron aplikace](#sestavení-electron-aplikace)
- [Přispěvatelé](#přispěvatelé)
- [Licence](#licence)

## O projektu

**Hydra** je **Herní Launcher** s jeho vlastním vestavěným **BitTorrent Klientem**.
<br>
Launcher je napsán v TypeScriptu (Electron) a Pythonu, který má na starosti torrentovací systém za pomocí knihovny libtorrent.

## Funkce

- Vlastní vestavěný BitTorrent klient
- How Long To Beat (HLTB) integrace na stránce hry
- Vlastní místa pro uložení hry
- Windows a Linux podpora
- Časté aktualizace
- A další ...

## Instalace

Následuj kroky:

1. Stáhni nejnovější verzi Hydry ze stránky [Vydání](https://github.com/hydralauncher/hydra/releases/latest).
   - Stáhni .exe, pokud chceš instalovat Hydru na Windows.
   - Stáhni .deb nebo .rpm nebo .zip, pokud chceš instalovat Hydru na Linux. (záleží na tvé Linux distribuci)
2. Spusť stažený instalační soubor.
3. Užívej Hydru!

## <a name="contributing"> Přispívání

### <a name="join-our-telegram"></a> Připoj se na náš telegram

Vedeme diskuzi v našem [Telegramovém](https://t.me/hydralauncher) kanálu.

### Vytvořte fork a naklonujte svůj repozitář

1. Vytvoř fork repozitáře [(klikni sem pro vytvoření forku)](https://github.com/hydralauncher/hydra/fork)
2. Naklonuj kód forku `git clone https://github.com/tvoje_jméno/hydra`
3. Vytvoř nové odvětví (branch)
4. Odešli svoje změny
5. Odešli nový Pull Request

### Způsoby jak můžete přispět

- Překládání: Chceme, aby Hydra byla co nejvíce dostupná. Můžete přispět novým jazykem, nebo úpravou současného!
- Kód: Hydra je postavena na Typescriptu, Electronu a trochou Pythonu. Pokud chceš přispět, připoj se na náš [Telegram](https://t.me/hydralauncher)!

### Struktura projektu

- torrent-client: Používáme libtorrent, Pythonovou knihovnu, pro správu torrent stahování
- src/renderer: uživatelské rozhraní aplikace (UI)
- src/main: celá logika projektu

## Sestavení ze zdroje

### Instalace Node.js

Ujistěte se, že máte Node.js nainstalován na svém zařízení. Pokud ne, stáhněte ho, a nainstalujte z [nodejs.org](https://nodejs.org/).

### Instalace Yarn

Yarn je balíčkový správce pro Node.js. Pokud ještě nemáte yarn, můžete ho stáhnout za pomoci pokynů na [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Instalace Požadavků pro Node.js

Jděte do složky projektu, otevřte v ní konzole a nainstalujte požadavky pro Node pomocí Yarn:

```bash
cd hydra
yarn
```

### Instalace Pythonu 3.9

Ujistěte se, že máte Python 3.9 nainstalován na svém zařízení. Můžete ho stáhnout z [python.org](https://www.python.org/downloads/release/python-3913/).

### Instalace Požadavků pro Python

Nainstalujte požadavky pro Python za pomoci pip:

```bash
pip install -r requirements.txt
```

## Proměnné prostředí

Budete potřebovat SteamGridDB API klíč, abyste mohli načítat ikony u her.

Jakmile ho máte, můžete zkopírovat, nebo přejmenovat `.env.example` soubor na `.env` a dát ho do `STEAMGRIDDB_API_KEY`.

## Spuštění

Jakmile máte vše nastaveno, můžete spustit jak Electron proces tak bittorrent client:

```bash
yarn dev
```

## Sestavení

### Sestavení bittorrent klientu

Sestavit bittorrent klient můžete pomocí:

```bash
python torrent-client/setup.py build
```

### Sestavení electron aplikace

Sestavit Electron aplikaci můžete pomocí následujících kroků:

Na Windows:

```bash
yarn build:win
```

Na Linux:

```bash
yarn build:linux
```

## Přispěvatelé

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## Licence

Hydra je licencována pod [MIT Licencí](LICENSE).
