<br>

<div align="center">
  <a href="https://hydralauncher.site">
    <img src="./resources/icon.png" width="144"/>
  </a>
  <h1 align="center">Hydra Launcher</h1>
  <p align="center">
    <strong>Hydra - это игровой лаунчер с собственным встроенным клиентом BitTorrent и самостоятельным scraper`ом для репаков.</strong>
  </p>
  <p>
    <a href="https://github.com/hydralauncher/hydra">
      <img src="https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml" />
    </a>
    <a href="https://github.com/hydralauncher/hydra">
      <img src="https://img.shields.io/github/package-json/v/hydralauncher/hydra" />
    </a>
  </p>

Для этого README на других языках выберите здесь:

[![pt-br](https://img.shields.io/badge/lang-pt--br-green.svg)](README.pt-br.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)

![Hydra Catalogue](./docs/screenshot.png)

</div>

<br>

### Язык
[![ru](https://img.shields.io/badge/lang-ru-red)](https://github.com/hydralauncher/hydra/blob/main/README.ru.md)

## Содержание

- [Описание](#описание)
- [Особенности](#особенности)
- [Установка](#установка)
- [Сотрудничество](#contributing)
  - [Присоединяйтесь к нашему Telegram](#join-our-telegram)
  - [Форк и клонирование репозитория](#форк-и-клонирование-репозитория)
  - [Способы внести свой вклад](#способы-внести-свой-вклад)
  - [Структура проекта](#структура-проекта)
- [Сборка из исходного кода](#сборка-из-исходного-кода)
  - [Установка Node.js](#установка-nodejs)
  - [Установка Yarn](#установка-yarn)
  - [Установка зависимостей Node](#установка-зависимостей-node)
  - [Установка Python 3.9](#установка-python-39)
  - [Установка зависимостей Python](#установка-зависимостей-python)
- [Переменные среды](#переменные-среды)
- [Запуск](#запуск)
- [Сборка](#сборка)
  - [Сборка клиента BitTorrent](#сборка-клиента-bittorrent)
  - [Сборка приложения Electron](#сборка-приложения-electron)
- [Участники](#участники)

## Описание

**Hydra** - это **Игровой Лаунчер** с собственным встроенным **Клиентом BitTorrent** и **самостоятельным scraper`ом для репаков**.
<br>
Лаунчер написан на TypeScript (Electron) и Python, который управляет системой торрентов с помощью libtorrent.

## Особенности

- Самостоятельный scraper репаков среди всех наиболее надежных веб-сайтов в [Megathread](https://www.reddit.com/r/Piracy/wiki/megathread/)
- Встроенный клиент BitTorrent
- Интеграция How Long To Beat (HLTB) на странице игры
- Настройка пути загрузки
- Уведомления об обновлении списка репаков
- Поддержка Windows и Linux
- Постоянно обновляется
- И многое другое...

## Установка

Чтобы установить, выполните следующие шаги:

1. Скачайте последнюю версию Hydra с [страницы релизов](https://github.com/hydralauncher/hydra/releases/latest).
    - Загрузите только .exe, если хотите установить Hydra на Windows.
    - Загрузите .deb или .rpm или .zip, если хотите установить Hydra на Linux (в зависимости от вашего дистрибутива Linux).
2. Запустите скачанный файл.
3. Наслаждайтесь Hydra!

## <a name="contributing"> Сотрудничество

### <a name="join-our-telegram"></a> Присоединяйтесь к нашему Telegram

Мы сосредотачиваем наши обсуждения в нашем канале [Telegram](https://t.me/hydralauncher).

### Форк и клонирование репозитория

1. Форкните репозиторий [(нажмите здесь, чтобы сделать форк сейчас)](https://github.com/hydralauncher/hydra/fork)
2. Склонируйте свой форкнутый код `git clone https://github.com/ваше_имя_пользователя/hydra`
3. Создайте новую ветку
4. Отправьте свои коммиты
5. Отправьте Pull Request

### Способы внести свой вклад

- Перевод: Мы хотим, чтобы Hydra была доступна как можно большему количеству людей. Не стесняйтесь помогать переводить на новые языки или обновлять и улучшать те, которые уже доступны в Hydra.
- Код: Hydra создан с использованием TypeScript, Electron и немного Python. Если хотите внести свой вклад, присоединяйтесь к нашему серверу [Telegram](https://t.me/hydralauncher)!

### Структура проекта

- torrent-client: Мы используем libtorrent, библиотеку Python, для управления загрузками торрентов.
- src/renderer: пользовательский интерфейс приложения.
- src/main: весь основной функционал здесь.

## Сборка из исходного кода

### Установка Node.js

Убедитесь, что у вас установлен Node.js на вашем компьютере. Если нет, загрузите и установите его с [nodejs.org](https://nodejs.org/).

### Установка Yarn

Yarn - менеджер пакетов для Node.js. Если вы еще не установили Yarn, сделайте это, следуя инструкциям на [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Установка зависимостей Node

Перейдите в каталог проекта и установите зависимости Node, используя Yarn:

```bash
cd hydra
yarn
```

### Установка Python 3.9

Убедитесь, что у вас установлен Python 3.9 на вашем компьютере. Вы можете загрузить и установить его с [python.org](https://www.python.org/downloads/release/python-3919/).

### Установка зависимостей Python

Установите необходимые зависимости Python, используя pip:

```bash
pip install -r requirements.txt
```

## Переменные среды

Вам понадобится ключ API SteamGridDB, чтобы получить значки игр при установке.
Если вы хотите использовать onlinefix в качестве репака, вам нужно добавить ваши учетные данные в файл .env.

Как только у вас будет ключ, вы можете скопировать или переименовать файл `.env.example` в `.env` и поместить в него `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Запуск

После того как все настроено, вы можете выполнить следующую команду, чтобы запустить процесс Electron и клиента BitTorrent:

```bash
yarn dev
```

## Сборка

### Сборка клиента BitTorrent

Соберите клиент BitTorrent с помощью этой команды:

```bash
python torrent-client/setup.py build
```

### Сборка приложения Electron

Соберите приложение Electron, используя эту команду:

На Windows:

```bash
yarn build:win
```

На Linux:

```bash
yarn build:linux
```

## Участники
Сделано с [contrib.rocks](https://contrib.rocks).

> [!NOTE]
> Обновление списка может занять до одного дня.

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>


## License

Hydra лицензирована в соответствии с [MIT License](LICENSE).
