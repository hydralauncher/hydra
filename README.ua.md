<br>

<div align="center">
  <a href="https://hydralauncher.site">
    <img src="./resources/icon.png" width="144"/>
  </a>
  <h1 align="center">Hydra Launcher</h1>
  <p align="center">
    <strong>Hydra - це ігровий лаунчер з власним вбудованим bittorrent-клієнтом і самокерованим збирачем репаків.</strong>
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

### Мова
[![ua](https://img.shields.io/badge/lang-ua-red)](https://github.com/hydralauncher/hydra/blob/main/README.ru.md)

## Зміст

- [Про нас](#про-нас)
- [Функції](#функції)
- [Встановлення](#встановлення)
- [Зробити свій внесок](#зробити-свій-внесок)
  - [Приєднуйтесь до нашого Discord](#приєднуйтесь-до-нашого-discord)
  - [Форк і клонування вашого репозиторію](#форк-і-клонування-вашого-репозиторію)
  - [Як ви можете зробити свій внесок](#як-ви-можете-зробити-свій-внесок)
  - [Структура проекту](#структура-проекту)
- [Зробити білд з вихідного коду](#зробити-білд-з-вихідного-коду)
  - [Встановіть Node.js](#встановіть-nodejs)
  - [Встановіть Yarn](#встановіть-yarn)
  - [Встановіть Node залежності](#встановіть-node-залежності)
  - [Встановіть Python 3.9](#встановіть-python-39)
  - [Встановіть Python залежності](#встановіть-python-залежності)
- [Змінні середовища](#змінні-середовища)
- [Запустіть](#запустіть)
- [Зробіть білд](#зробіть-білд)
  - [Зробіть білд bittorrent client](#зробіть-білд-bittorrent-client)
  - [Зробіть білд Electron застосунку](#зробіть-білд-electron-застосунку)
- [Контриб'ютори](#контрибютори)

## Про нас

**Hydra** - це **ігровий лаунчер** з власним вбудованим **BitTorrent-клієнтом** і **самокерованим збирачем репаків**.
<br>
Цей лаунчер написано мовами TypeScript (Electron) та Python, який працює з торрент-системою за допомогою libtorrent.

## Функції

- Самокерований збирач репаків серед усіх найнадійніших сайтів на [Megathread]("https://www.reddit.com/r/Piracy/wiki/megathread/")
- Власний вбудований клієнт bittorrent
- Інтеграція How Long To Beat (HLTB) на сторінці гри
- Налаштування теки завантаження
- Сповіщення про оновлення списку репаків
- Підтримка Windows і Linux
- Постійно оновлюється
- І не тільки ...

## Встановлення

Follow the steps below to install:

1. Завантажте останню версію Hydra зі сторінки [Releases](https://github.com/hydralauncher/hydra/releases/latest).
   - Завантажте лише .exe, якщо ви хочете встановити Hydra на Windows.
   - Завантажте .deb або .rpm або .zip, якщо ви хочете встановити Hydra на Linux. (залежить від вашого дистрибутива Linux)
2. Запустіть завантажений файл.
3. Насолоджуйтесь Гідрою!

## Зробити свій внесок

### Приєднуйтесь до нашого Discord

Ми зосереджуємо наші дискусії на нашому сервері [Discord](https://discord.gg/hydralauncher).

1. Приєднуйтесь до нашого сервера
2. Перейдіть на канал ролей і виберіть роль Співробітник
3. Заходьте на dev-канал, спілкуйтеся з нами та діліться своїми ідеями.

### Форк і клонування вашого репозиторію

1. Зробіть форк репозиторію [(натисніть тут, щоб зробити форк зараз)](https://github.com/hydralauncher/hydra/fork)
2. Клонуйте ваш форк-код `git clone https://github.com/your_username/hydra`
3. Створіть новий бранч
4. Зробіть пуш своїх комітів
5. Надішліть новий Pull Request

### Як ви можете зробити свій внесок

- Translation: We want Hydra to be available to as many people as possible. Feel free to help translate to new languages or update and improve the ones that are already available on Hydra.
- Code: Hydra is built with Typescript, Electron and a little bit of Python. If you want to contribute, join our Discord server!

### Структура проекту

- torrent-client: Ми використовуємо libtorrent, бібліотеку Python, для керування завантаженнями з торрентів
- src/renderer: інтерфейс програми
- src/main: вся логіка тут.

## Зробити білд з вихідного коду

### Встановіть Node.js

Переконайтеся, що на вашому комп'ютері встановлено Node.js. Якщо ні, завантажте та встановіть його з [nodejs.org](https://nodejs.org/).

### Встановіть Yarn

Yarn - це менеджер пакетів для Node.js. Якщо ви ще не встановили Yarn, ви можете зробити це, дотримуючись інструкцій на сторінці [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Встановіть Node залежності

Перейдіть до каталогу проекту і встановіть Node залежності за допомогою Yarn:

```bash
cd hydra
yarn
```

### Встановіть Python 3.9

Переконайтеся, що на вашому комп'ютері встановлено Python 3.9. Ви можете завантажити та встановити його з [python.org](https://www.python.org/downloads/release/python-3919/).

### Встановіть Python залежності

Встановіть необхідні залежності Python за допомогою pip:

```bash
pip install -r requirements.txt
```

## Змінні середовища

Вам знадобиться ключ API SteamGridDB, щоб отримати іконки ігор під час встановлення.
Якщо ви хочете використовувати onlinefix як перепакувальник, вам потрібно додати свої облікові дані до .env

Отримавши його, ви можете скопіювати або перейменувати файл `.env.example` на `.env`і помістити його на`STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Запустіть

Після того, як ви все налаштували, ви можете запустити наступну команду, щоб запустити як процес Electron, так і клієнт bittorrent:

```bash
yarn dev
```

## Зробіть білд

### Зробіть білд bittorrent client

Зробіть білд bittorrent client за допомогою цієї команди:

```bash
python torrent-client/setup.py build
```

### Зробіть білд Electron застосунку

Зробіть білд Electron застосунку за допомогою цієї команди:

На Windows:

```bash
yarn build:win
```

На Linux:

```bash
yarn build:linux
```

## Контриб'ютори

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
        <a href="https://github.com/Mkdantas">
            <img src="https://avatars.githubusercontent.com/u/50972667?v=4" width="100;" alt="Mkdantas"/>
            <br />
            <sub><b>Matheus Dantas</b></sub>
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
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/xbozo">
            <img src="https://avatars.githubusercontent.com/u/119091492?v=4" width="100;" alt="xbozo"/>
            <br />
            <sub><b>Guilherme Viana</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Tunchichi">
            <img src="https://avatars.githubusercontent.com/u/118926729?v=4" width="100;" alt="Tunchichi"/>
            <br />
            <sub><b>Ruslan</b></sub>
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
    </td>
    <td align="center">
        <a href="https://github.com/vnumex">
            <img src="https://avatars.githubusercontent.com/u/10434535?v=4" width="100;" alt="vnumex"/>
            <br />
            <sub><b>Vnumex</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/FerNikoMF">
            <img src="https://avatars.githubusercontent.com/u/76095334?v=4" width="100;" alt="FerNikoMF"/>
            <br />
            <sub><b>Firdavs</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/PCTroller">
            <img src="https://avatars.githubusercontent.com/u/146987801?v=4" width="100;" alt="PCTroller"/>
            <br />
            <sub><b>Null</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Chr1s0Blood">
            <img src="https://avatars.githubusercontent.com/u/166660500?v=4" width="100;" alt="Chr1s0Blood"/>
            <br />
            <sub><b>Cristian S.</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/ChristoferMendes">
            <img src="https://avatars.githubusercontent.com/u/107426464?v=4" width="100;" alt="ChristoferMendes"/>
            <br />
            <sub><b>Christofer Luiz Dos Santos Mendes</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/userMacieG">
            <img src="https://avatars.githubusercontent.com/u/24211405?v=4" width="100;" alt="userMacieG"/>
            <br />
            <sub><b>Maciej Ratyński</b></sub>
        </a>
    </td></tr>
</table>
<!-- readme: contributors -end -->

## License

Hydra має ліцензію [MIT License](LICENSE).
