<br>

<div align="center">

  [<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>
  
  <p align="center">
    <strong>Hydra - це ігровий лаунчер з власним вбудованим bittorrent-клієнтом і самокерованим збирачем репаків.</strong>
  </p>

  [![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
  [![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

  [![pt-BR](https://img.shields.io/badge/lang-pt--BR-green.svg)](README.pt-BR.md)
  [![en](https://img.shields.io/badge/lang-en-red.svg)](README.md)
  [![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)
  [![uk-UA](https://img.shields.io/badge/lang-uk--UA-blue)](README.uk-UA.md)

  ![Hydra Catalogue](./docs/screenshot.png)

</div>

## Зміст

- [Про нас](#про-нас)
- [Функції](#функції)
- [Встановлення](#встановлення)
- [Зробити свій внесок](#contributing)
  - [Приєднуйтесь до нашого Telegram](#join-our-telegram)
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

Щоб встановити, виконайте наведені нижче кроки:

1. Завантажте останню версію Hydra зі сторінки [Releases](https://github.com/hydralauncher/hydra/releases/latest).
   - Завантажте лише .exe, якщо ви хочете встановити Hydra на Windows.
   - Завантажте .deb або .rpm або .zip, якщо ви хочете встановити Hydra на Linux. (залежить від вашого дистрибутива Linux)
2. Запустіть завантажений файл.
3. Насолоджуйтесь Гідрою!

## <a name="contributing"> Зробити свій внесок

### <a name="join-our-telegram"></a> Приєднуйтесь до нашого Telegram

Ми зосереджуємо наші дискусії на нашому сервері [Telegram](https://t.me/hydralauncher).

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

- Переклад: Ми хочемо, щоб Hydra була доступна якомога більшій кількості людей. Не соромтеся допомагати перекладати на нові мови або оновлювати і покращувати ті, які вже доступні на Hydra.
- Код: Hydra створена за допомогою Typescript, Electron і трохи Python. Якщо ви хочете зробити свій внесок, приєднуйтесь до нашого Telegram!

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

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## License

Hydra має ліцензію [MIT License](LICENSE).
