<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra - to program uruchamiający gry z własnym wbudowanym klientem bittorrent.</strong>
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
[![tr](https://img.shields.io/badge/lang-tr-red.svg)](README.tr.md)

![Hydra Catalogue](./screenshot.png)

</div>

## Zawartość.

- [Zawartość.](#zawartość)
- [O nas](#o-nas)
- [Cechy](#cechy)
- [Instalacja](#instalacja)
- [Dokonaj wpłaty](#-dokonaj-wpłaty)
  - [Dołącz do naszego kanału Telegram](#-dołącz-do-naszego-kanału-telegram)
  - [Rozwidlenie i sklonowanie repozytorium](#rozwidlenie-i-sklonowanie-repozytorium)
  - [Jak możesz pomóc](#jak-możesz-pomóc)
  - [Struktura projektu](#struktura-projektu)
- [Utwórz kompilację z kodu źródłowego](#utwórz-kompilację-z-kodu-źródłowego)
  - [Zainstaluj Node.js](#zainstaluj-nodejs)
  - [Zainstaluj Yarn](#zainstaluj-yarn)
  - [Zainstaluj zależności Node](#zainstaluj-zależności-node)
  - [Zainstaluj Python 3.9](#zainstaluj-python-39)
  - [Zainstaluj zależności Pythona](#zainstaluj-zależności-pythona)
- [Zmienne środowiskowe](#zmienne-środowiskowe)
- [Run](#run)
- [Tworzenie kompilacji](#tworzenie-kompilacji)
  - [Zbuduj klienta bittorrent](#zbuduj-klienta-bittorrent)
  - [Tworzenie aplikacji Electron](#tworzenie-aplikacji-electron)
- [Współtwórcy](#współtwórcy)
- [License](#license)

## O nas

**Hydra** - jest **programem uruchamiającym gry** z wbudowanym **klientem BitTorrent**.
<br>
Ten launcher jest napisany w TypeScript (Electron) i Pythonie, który współpracuje z systemem torrent przy użyciu libtorrent.

## Cechy

- Własny wbudowany klient bittorrent
- Integracja funkcji How Long To Beat (HLTB) na stronie gry
- Personalizacja folderu pobierania
- Wsparcie dla systemów Windows i Linux
- Stała aktualizacja
- I nie tylko ...

## Instalacja

Aby zainstalować, wykonaj poniższe czynności:

1. Pobierz najnowszą wersję programu Hydra ze strony [Wydania](https://github.com/hydralauncher/hydra/releases/latest).
   - Pobierz .exe tylko, jeśli chcesz zainstalować Hydrę w systemie Windows.
   - Pobierz .deb lub .rpm lub .zip, jeśli chcesz zainstalować Hydrę w systemie Linux (zależy od dystrybucji systemu Linux).
2. Uruchom pobrany plik.
3. Ciesz się Hydrą!

## <a name="contributing"> Dokonaj wpłaty

### <a name="join-our-telegram"></a> Dołącz do naszego kanału Telegram

Skupiamy nasze dyskusje na naszym kanale [Telegram](https://t.me/hydralauncher).

1. Dołącz do naszego kanału
2. Przejdź do kanału ról i wybierz rolę Pracownik.
3. Wejdź na kanał dev, komunikuj się z nami i dziel się swoimi pomysłami.

### Rozwidlenie i sklonowanie repozytorium

1. Rozwidlenie repozytorium [(kliknij tutaj, aby rozwidlić teraz)](https://github.com/hydralauncher/hydra/fork)
2. Sklonuj swój rozwidlony kod `git clone https://github.com/your_username/hydra`.
3. Utwórz nowy brunch
4. Wypchnij swoje zatwierdzenia
5. Wyślij nowy Pull Request

### Jak możesz pomóc

- Tłumaczenie: Chcemy, aby Hydra była dostępna dla jak największej liczby osób. Zachęcamy do pomocy w tłumaczeniu na nowe języki lub aktualizowaniu i ulepszaniu tych, które są już dostępne na Hydrze.
- Kod: Hydra jest zbudowana przy użyciu Typescript, Electron i odrobiny Pythona. Jeśli chcesz wnieść swój wkład, dołącz do naszego kanału Telegram!

### Struktura projektu

- Klient torrent: Używamy libtorrent, biblioteki Pythona, do zarządzania pobieraniem torrentów.
- src/renderer: interfejs aplikacji
- src/main: cała logika jest tutaj.

## Utwórz kompilację z kodu źródłowego

### Zainstaluj Node.js

Upewnij się, że masz zainstalowany Node.js na swoim komputerze. Jeśli nie, pobierz i zainstaluj go ze strony [nodejs.org](https://nodejs.org/).

### Zainstaluj Yarn

Yarn to menedżer pakietów dla Node.js. Jeśli jeszcze nie zainstalowałeś Yarn, możesz to zrobić, postępując zgodnie z instrukcjami na stronie [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Zainstaluj zależności Node

Przejdź do katalogu projektu i zainstaluj zależności Node za pomocą Yarn:

```bash
cd hydra
yarn
```

### Zainstaluj Python 3.9

Upewnij się, że masz zainstalowany Python 3.9 na swoim komputerze. Można go pobrać i zainstalować ze strony [python.org](https://www.python.org/downloads/release/python-3913/).

### Zainstaluj zależności Pythona

Zainstaluj niezbędne zależności Pythona za pomocą pip:

```bash
pip install -r requirements.txt
```

## Zmienne środowiskowe

Będziesz potrzebował klucza API SteamGridDB, aby uzyskać ikony gier podczas instalacji.

Po jego uzyskaniu można skopiować plik lub zmienić jego nazwę `.env.example` na `.env` i umieść go na`STEAMGRIDDB_API_KEY`.

## Run

Po skonfigurowaniu wszystkiego można uruchomić następujące polecenie, aby uruchomić zarówno proces Electron, jak i klienta bittorrent:

```bash
yarn dev
```

## Tworzenie kompilacji

### Zbuduj klienta bittorrent

Zbuduj klienta bittorrent za pomocą tego poleceniaи:

```bash
python torrent-client/setup.py build
```

### Tworzenie aplikacji Electron

Zbuduj aplikację Electron za pomocą tego polecenia:

W systemie Windows:

```bash
yarn build:win
```

W systemie Linux:

```bash
yarn build:linux
```

## Współtwórcy

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## License

Hydra posiada licencję [MIT License](LICENSE).
