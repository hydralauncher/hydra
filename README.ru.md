<br>

<div align="center">
  <a href="https://hydralauncher.site">
    <img src="./resources/icon.png" width="144"/>
  </a>
  <h1 align="center">Hydra Launcher</h1>
  <p align="center">
    <strong>Hydra-это игровой лаунчер со своим собственным встроенным клиентом BitTorrent и самоуправляемым скребком репаков.</strong>
  </p>
  <p>
    <a href="https://discord.gg/hydralauncher">
      <img src ="https://img.shields.io/discord/1220692017311645737?style=flat&logo=discord&label=Hydra&labelColor=%231c1c1c"/>
    </a>
    <a href="https://github.com/hydralauncher/hydra">
      <img src="https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml" />
    </a>
    <a href="https://github.com/hydralauncher/hydra">
      <img src="https://img.shields.io/github/package-json/v/hydralauncher/hydra" />
    </a>
  </p>

![Hydra Catalogue](./docs/screenshot.png)

</div>

<br>

### Язык
[![en](https://img.shields.io/badge/lang-en-red)](https://github.com/hydralauncher/hydra/blob/main/README.md)
[![ua](https://img.shields.io/badge/lang-ru-red)](https://github.com/hydralauncher/hydra/blob/main/README.ru.md)
[![ua](https://img.shields.io/badge/lang-ua-red)](https://github.com/hydralauncher/hydra/blob/main/README.ua.md)


## Содержание

- [О нас](#о-нас)
- [Функции](#функции)
- [Установка](#установка)
- [Сотрудничество](#сотрудничество)
  - [Присоединяйтесь к нашему Discord](#присоединяйтесь-к-нашему-discord)
  - [Ответвлить и клонировать свой репозиторий](#ответвлить-и-клонировать-свой-репозиторий)
  - [Способы внести свой вклад](#способы-внести-свой-вклад)
  - [Структура проекта](#структура-проекта)
- [Создать из источника](#создать-из-источника)
  - [Установите Node.js](#установите-nodejs)
  - [Установите Yarn](#установите-yarn)
  - [Установите зависимости Node](#установите-зависимости-node)
  - [Установите Python 3.9](#установите-python-39)
  - [Установите зависимости Python](#установите-зависимости-python)
- [Переменные среды](#переменные-среды)
- [Запуск](#запуск)
- [Создание](#создание)
  - [Создайте клиент BitTorrent](#создайте-клиент-bittorrent)
  - [Создайте приложение Electron](#создайте-приложение-electron)
- [Участники](#участники)

## О нас

**Hydra**-это **Игровой Лаунчер** со своим собственным встроенным **BitTorrent Client** и **самоуправляемым скребком репаков**.
<br>
Лаунчер написан на TypeScript (Electron) и Python, который обрабатывает систему торрента с использованием LibTorrent.

## Функции

- Самоуправляемый скребок репаков среди всех самых надежных веб-сайтов на [Megathread]("https://www.reddit.com/r/Piracy/wiki/megathread/")
- Собственный встроенный клиент BitTorrent
- Как долго пробиться (HLTB) интеграция на странице игры
- Загрузка настройки пути
- Уведомления об обновлении списка репаков
- Поддержка Windows и Linux
- Постоянно обновляется
- И более ...

## Установка

Следуйте приведенным ниже шагам, чтобы установить:

1. Загрузите последнюю версию Hydra из [Выпуски](https://github.com/hydralauncher/hydra/releases/latest).
   - Загрузите только .exe, если вы хотите установить Hydra в Windows.
   - Скачать .deb или .rpm или .zip, если вы хотите установить Hydra на Linux.(Зависит от вашего дистрибутива Linux)
2. Запустите загруженный файл.
3. Наслаждаться Hydra!

## Сотрудничество

### Присоединяйтесь к нашему Discord

Мы концентрируем наши обсуждения на нашем [Discord](https://discord.gg/hydralauncher) сервере.

1. Присоединяйтесь к нашему серверу
2. Перейдите на роли канала и возьмите роль сотрудничества
3. Зайдите на канал Dev, поговорите с нами и поделитесь своими идеями.

### Ответвлить и клонировать свой репозиторий

1. Ответвление репозитория [(Нажмите здесь, чтобы сейчас ответвлить)](https://github.com/hydralauncher/hydra/fork)
2. Клонировать свой ответвленный код `git clone https://github.com/your_username/hydra`
3. Создать новую ветку
4. Подтолкнуть свои коммиты
5. Отправить новый запрос на привлечение

### Способы внести свой вклад

- Перевод: Мы хотим, чтобы Hydra была доступна как можно большему количеству людей. Не стесняйтесь переводить на новые языки или обновить и улучшить те, которые уже доступны на Hydra.
- Код: Hydra построена на TypeScript, Electron и немного Python.Если вы хотите внести свой вклад, присоединяйтесь к нашему серверу Discord!

### Структура проекта

- torrent-client: Мы используем LibTorrent, библиотеку Python, чтобы управлять загрузками торрента
- src/renderer: пользовательский интерфейс приложения
- src/main: Вся логика отдыхает здесь.

## Создать из источника

### Установите Node.js

Убедитесь, что у вас установлен Node.js на вашем компьютере.Если нет, загрузите и установите из [nodejs.org](https://nodejs.org/).

### Установите Yarn

Yarn является менеджером пакетов для node.js. Если вы еще не установили Yarn, вы можете сделать это, следуя инструкциям на [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Установите зависимости Node

Перейдите к каталогу проекта и установите Node зависимости с использованием Yarn:

```bash
cd hydra
yarn
```

### Установите Python 3.9

Убедитесь, что на вашем компьютере установлен Python 3.9. Вы можете скачать и установить его из [python.org](https://www.python.org/downloads/release/python-3919/).

### Установите зависимости Python

Установите необходимые зависимости Python, используя pip:

```bash
pip install -r requirements.txt
```

## Переменные среды

Вам понадобится ключ API SteamGridDB, чтобы принести значки игры при установке.
Если вы хотите получить онлайн -фикс в качестве репака, вам нужно добавить свои учетные данные в .env

Как только он у вас есть, вы можете скопировать или переименовать `.env.example` файл в `.env`и заполнить это`STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Запуск

После того, как у вас все настроено, вы можете запустить следующую команду, чтобы запустить приложение Electron и клиент BitTorrent:

```bash
yarn dev
```

## Создание

### Создайте клиент BitTorrent

Создайте клиент BitTorrent, используя эту команду:

```bash
python torrent-client/setup.py build
```

### Создайте приложение Electron

Создайте приложение Electron с помощью этой команды:

В Windows:

```bash
yarn build:win
```

В Linux:

```bash
yarn build:linux
```

## Участники

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
        <a href="https://github.com/Magrid0">
            <img src="https://avatars.githubusercontent.com/u/73496008?v=4" width="100;" alt="Magrid0"/>
            <br />
            <sub><b>Magrid</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/fhilipecrash">
            <img src="https://avatars.githubusercontent.com/u/36455575?v=4" width="100;" alt="fhilipecrash"/>
            <br />
            <sub><b>Fhilipe Coelho</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/jps14">
            <img src="https://avatars.githubusercontent.com/u/168477146?v=4" width="100;" alt="jps14"/>
            <br />
            <sub><b>José Luís</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/shadowtosser">
            <img src="https://avatars.githubusercontent.com/u/168544958?v=4" width="100;" alt="shadowtosser"/>
            <br />
            <sub><b>Null</b></sub>
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
        <a href="https://github.com/eltociear">
            <img src="https://avatars.githubusercontent.com/u/22633385?v=4" width="100;" alt="eltociear"/>
            <br />
            <sub><b>Ikko Eltociear Ashimine</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/Netflixyapp">
            <img src="https://avatars.githubusercontent.com/u/91623880?v=4" width="100;" alt="Netflixyapp"/>
            <br />
            <sub><b>Netflixy</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Hachi-R">
            <img src="https://avatars.githubusercontent.com/u/58823742?v=4" width="100;" alt="Hachi-R"/>
            <br />
            <sub><b>Hachi</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/FerNikoMF">
            <img src="https://avatars.githubusercontent.com/u/76095334?v=4" width="100;" alt="FerNikoMF"/>
            <br />
            <sub><b>Firdavs</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/userMacieG">
            <img src="https://avatars.githubusercontent.com/u/24211405?v=4" width="100;" alt="userMacieG"/>
            <br />
            <sub><b>Maciej Ratyński</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Tunchichi">
            <img src="https://avatars.githubusercontent.com/u/118926729?v=4" width="100;" alt="Tunchichi"/>
            <br />
            <sub><b>Ruslan</b></sub>
        </a>
    </td></tr>
</table>
<!-- readme: contributors -end -->

## License

Hydra лицензирована в соответствии с лицензией [MIT License](LICENSE).
