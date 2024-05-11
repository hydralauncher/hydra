<br>

<div align="center">
  <a href="https://hydralauncher.site">
    <img src="./resources/icon.png" width="144"/>
  </a>
  <h1 align="center">Hydra Launcher</h1>
  <p align="center">
    <strong>Hydra - це ігровий лаунчер із власним вбудованим клієнтом BitTorrent і самостійним scraper`ом для репаків</strong>
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

### Мови
[![ru](https://img.shields.io/badge/lang-ru-red)](https://github.com/hydralauncher/hydra/blob/main/README.ru.md) <br>
[![uk](https://img.shields.io/badge/lang-uk-red)](https://github.com/hydralauncher/hydra/blob/main/README.uk.md) <br>
[![en](https://img.shields.io/badge/lang-en-red)](https://github.com/hydralauncher/hydra/blob/main/README.md) 



## Содержание

- [Опис](#опис)
- [Особливості](#особливості)
- [Встановлення](#встановлення)
- [Співпраця](#співпраця)
  - [Приєднуйтесь до нашого Discord](#приєднуйтесь-до-нашого-discord)
  - [Форк і клонування репозиторію](#форк-і-клонування-репозиторію)
  - [Способи зробити свій внесок](#способи-зробити-свій-внесок)
  - [Структура проекту](#структура-проекту)
- [Збірка з вихідного коду](#збірка-з-вихідного-коду)
  - [Встановлення Node.js](#встановлення-nodejs)
  - [Встановлення Yarn](#встановлення-yarn)
  - [Встановлення залежностей Node](#встановлення-зависимостей-node)
  - [Встановлення Python 3.9](#встановлення-python-39)
  - [Встановлення залежностей Python](#встановлення-зависимостей-python)
- [Змінні середовища](#зміні-середовища)
- [Запуск](#запуск)
- [Збірка](#збірка)
  - [Збірка клієнту BitTorrent](#збірка-клієнту-bittorrent)
  - [Збірка програми Electron](#збірка-програми-electron)
- [Учасники](#учасники)

## Опис

**Hydra** - це **Ігровий Лаунчер** з власним вбудованим **Клієнтом BitTorrent** і **самостійним scraper`ом для репаків**.
<br>
Лаунчер написаний на TypeScript (Electron) і Python, який керує системою торрентів за допомогою libtorrent.

## Особливості

- Самостійний scraper репаків серед усіх найнадійніших веб-сайтів у [Megathread](https://www.reddit.com/r/Piracy/wiki/megathread/)
- Вбудований клієнт BitTorrent
- Інтеграція How Long To Beat (HLTB) на сторінці гри
- Налаштування шляху завантаження
- Повідомлення про оновлення списку репаків
- Підтримка Windows і Linux
- Постійно оновлюється
- І багато іншого...

## Встановлення

Щоб встановити, виконайте такі кроки:

1. Завантажте останню версію Hydra зі [сторінки релізів](https://github.com/hydralauncher/hydra/releases/latest).
    - Завантажте лише .exe, якщо хочете встановити Hydra на Windows.
    - Завантажте .deb або .rpm або .zip, якщо хочете встановити Hydra на Linux (залежно від вашого дистрибутива Linux).
2. Запустіть завантажений файл.
3. насолоджуйтеся Hydra!

## Співпраця

### Приєднуйтесь до нашого Discord

Ми зосереджуємо наші обговорення на нашому [Discord](https://discord.gg/hydralauncher) сервері.

1. Приєднайтеся до нашого сервера.
2. Перейдіть у канал ролей і отримайте роль Collaborator.
3. Перейдіть у канал Dev, спілкуйтеся з нами та діліться своїми ідеями.

### Форк і клонування репозиторію

1. Форкніть репозиторій [(натисніть тут, щоб зробити форк зараз)](https://github.com/hydralauncher/hydra/fork)
2. Склонуйте свій форкнутий код `git clone https://github.com/ваше_имя_користувача/hydra`.
3. Створіть нову гілку
4. надішліть свої коміти
5. Надішліть Pull Request

### Способи зробити свій внесок

- Перевод: Мы хотим, чтобы Hydra была доступна как можно большему количеству людей. Не стесняйтесь помогать переводить на новые языки или обновлять и улучшать те, которые уже доступны в Hydra.
- Код: Hydra создан с использованием TypeScript, Electron и немного Python. Если хотите внести свой вклад, присоединяйтесь к нашему серверу Discord!

### Структура проекту

- torrent-client: Ми використовуємо libtorrent, бібліотеку Python, для керування завантаженнями торрентів.
- src/renderer: користувацький інтерфейс програми.
- src/main: весь основний функціонал тут.

## Збірка з вихідного коду

### Встановлення Node.js

Переконайтеся, що у вас встановлено Node.js на вашому комп'ютері. Якщо ні, завантажте та встановіть його з [nodejs.org](https://nodejs.org/).

### Встановлення Yarn

Yarn - менеджер пакетів для Node.js. Якщо ви ще не встановили Yarn, зробіть це, дотримуючись інструкцій на [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Встановлення залежностей Node

Перейдіть у каталог проєкту та встановіть залежності Node, використовуючи Yarn:

```bash
cd hydra
yarn
```

### Встановлення Python 3.9

Переконайтеся, що у вас встановлено Python 3.9 на вашому комп'ютері. Ви можете завантажити та встановити його з [python.org](https://www.python.org/downloads/release/python-3919/).

### Встановлення залежностей Python

Установите необходимые зависимости Python, используя pip:

```bash
pip install -r requirements.txt
```

## Змінні середовища

Вам знадобиться ключ API SteamGridDB, щоб отримати значки ігор під час встановлення.
Якщо ви хочете використовувати onlinefix як репак, вам потрібно додати свої облікові дані до файлу .env.

Як тільки у вас буде ключ, ви можете скопіювати або перейменувати файл `.env.example` в `.env` і помістити в нього `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Запуск

Після того як все налаштовано, ви можете виконати наступну команду, щоб запустити процес Electron і клієнта BitTorrent:

```bash
yarn dev
```

## Збірка

### Збірка клієнту BitTorrent

Соберите клиент BitTorrent с помощью этой команды:

```bash
python torrent-client/setup.py build
```

### Збірка програми Electron

Зберіть додаток Electron, використовуючи цю команду:

На Windows:

```bash
yarn build:win
```

На Linux:

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

Hydra ліцензована відповідно до [MIT License](LICENSE).
