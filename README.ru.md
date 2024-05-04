# Hydra

<a href="https://discord.gg/hydralauncher" target="_blank">![Discord](https://img.shields.io/discord/1220692017311645737?style=flat&logo=discord&label=Hydra&labelColor=%231c1c1c)</a>
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)
![GitHub package.json version](https://img.shields.io/github/package-json/v/hydralauncher/hydra)

Hydra представляет собой игровой лаунчер со встроенным bittorrent-клиентом и автономным средством очистки репаков.
Лаунчер написан на TypeScript (Electron) и Python, которые управляют системой обмена торрентами с помощью [libtorrent](https://www.libtorrent.org/).

![Hydra Catalogue](./docs/screenshot.png)

## Установка

### УстановитьNode.js

Убедитесь, что у вас установлен Node.js на вашем компьютере.Если нет, загрузите и установите из[nodejs.org](https://nodejs.org/).

### Установить Yarn

Пряжа - менеджер пакетов для node.js.Если вы еще не установили пряжу, вы можете сделать это, следуя инструкциям на [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Клонировать репозиторий

```bash
git clone https://github.com/hydralauncher/hydra.git
```

### Установите зависимости Node

Перейдите к каталогу проекта и установите зависимости Node с помощью Yarn:

```bash
cd hydra
yarn
```

### Установить Python 3.9

Убедитесь, что на вашем компьютере установлен Python.Вы можете скачать и установить его из [python.org](https://www.python.org/downloads/release/python-3919/).

### Установите зависимости Python

Установите необходимые зависимости от Python, используя pip:

```bash
pip install -r requirements.txt
```

## Переменные среды

Вам понадобится ключ API SteamGridDB, чтобы получить значки игры при установке.
Если вы хотите получить OnlineFix в качестве репака, вам нужно добавить свои учетные данные в .env

Как только он у вас будет, вы можете вставить в`.env.example` и поместить его в` steamgriddb_api_key`, `onlinefix_username`,` onlinefix_password`.
## Запуск
После того, как у вас все настроено, вы можете запустить следующую команду, чтобы запустить Electron и клиент BitTorrent:

```bash
yarn start
```

## Создание

### Создайте клиент BitTorrent

Создайте клиент BitTorrent, используя эту команду:

```bash
python torrent-client/setup.py build
```

### Создайте приложение Electron

Создайте приложение Electron, используя эту команду:

```bash
yarn make
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
        <a href="https://github.com/pmenta">
            <img src="https://avatars.githubusercontent.com/u/71457671?v=4" width="100;" alt="pmenta"/>
            <br />
            <sub><b>João Martins</b></sub>
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
        <a href="https://github.com/FerNikoMF">
            <img src="https://avatars.githubusercontent.com/u/76095334?v=4" width="100;" alt="FerNikoMF"/>
            <br />
            <sub><b>Firdavs</b></sub>
        </a>
    </td></tr>
</table>
<!-- readme: contributors -end -->

## Лицензия

Hydra лицензирована в соответствии с лицензией [MIT](LICENSE).
