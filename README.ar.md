<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>
  
  <p align="center">
    <strong>Hydra es un lanzador de juegos con su propio cliente de bittorrent integrado y un contenedor autogerenciado para buscar repacks.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

[![pt-BR](https://img.shields.io/badge/lang-pt--BR-green.svg)](README.pt-BR.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)
[![uk-UA](https://img.shields.io/badge/lang-uk--UA-blue)](README.uk-UA.md)
[![be](https://img.shields.io/badge/lang-be-orange)](README.be.md)

![Hydra Catalogue](./docs/screenshot.png)

</div>

## Índice

- [Acerca](#about)
- [Funciones](#features)
- [Instalación](#installation)
- [Contribuyendo](#contributing)
  - [Únete a nuestro Telegram](#join-our-telegram)
  - [Bifurca y clona tu repositorio](#fork-and-clone-your-repository)
  - [Maneras en que puedes contribuir](#ways-you-can-contribute)
  - [Estructura del proyecto](#project-structure)
- [Construir desde fuente](#build-from-source)
  - [Instale Node.js](#install-nodejs)
  - [Instale Yarn](#install-yarn)
  - [Instale Node Dependencies](#install-node-dependencies)
  - [Instale Python 3.9](#install-python-39)
  - [Instale Python Dependencies](#install-python-dependencies)
- [Variables de entorno](#environment-variables)
- [Corriendo](#running)
- [Compilando](#build)
  - [Compile el cliente bittorrent](#build-the-bittorrent-client)
  - [Compile la aplicación Electron](#build-the-electron-application)
- [Colaboradores](#contributors)

## <a name="about"> Acerca

**Hydra** es un **Lanzador de Juegos** con su propio **Cliente BitTorrent integrado** y un **raspador de reempaquetado autoadministrado**.
<br>
El iniciador está escrito en TypeScript (Electron) y Python, que maneja el sistema de torrents mediante libtorrent.

## <a name="features"> Recursos

- Envoltorio de reempaquetado autoadministrado en todos los sitios más confiables en [Megathread]("https://www.reddit.com/r/Piracy/wiki/megathread/")
- Cliente BitTorrent propio incorporado
- Integración con [How Long To Beat (HLTB)](https://howlongtobeat.com/) en la página del juego
- Personalización de la ruta de descargas.
- Notificaciones de actualización de la lista de reempaquetado
- Soporte para Windows y Linux
- Constantemente actualizado
- Y más ...

## <a name="installation"> Instalación

Siga los pasos a continuación para instalar:

1. Instale la última versión de Hydra desde la página [Lanzamientos](https://github.com/hydralauncher/hydra/releases/latest).
   - Instalar sólo el .exe si desea instalar Hydra en Windows.
   - Instalar .deb o .rpm o .zip si desea instalar Hydra en Linux. (depende de su distribución de Linux)
2. Ejecute el archivo descargado.
3. Disfruta de Hidra!

## <a name="contributing"> Contribuyendo

### <a name="join-our-telegram"></a> Únete a nuestro Telegram

Centramos nuestras discusiones en nuestro canal [Telegram](https://t.me/hydralauncher).

### <a name="fork-and-clone-your-repository"></a> Bifurca y clona tu repositorio

1. Bifurque el repositorio [(haga clic aquí para bifurcar ahora)](https://github.com/hydralauncher/hydra/fork)
2. Clona el código de tu fork `git clone https://github.com/seu_nome_de_usuário/hydra`
3. Crea una nueva branch
4. Haz el push de tus commits
5. Envíe una nueva Pull Request

### <a name="ways-you-can-contribute"></a> Maneras en las que puedes contribuir

- **Traducción**: Queremos que Hydra esté disponible para la mayor cantidad de personas posible. No dudes en ayudar a traducir a nuevos idiomas o actualizar y mejorar los que ya están disponibles en Hydra.
- **Código**: Hydra está construido con Typecript, Electron y un poco de Python. Si quieres contribuir, únete a nuestro [Telegram](https://t.me/hydralauncher)!

### <a name="project-structure"></a> Estructura del proyecto

- torrent-client: utilizamos libtorrent, una biblioteca de Python, para gestionar las descargas de torrents.
- src/renderer: la interfaz de usuario (UI) de la aplicación.
- src/main: toda la lógica de la aplicación reside aquí.

## <a name="build-from-source"></a> Compilar desde el código fuente

### <a name="install-nodejs"></a> Instalar Node.js

Asegúrese de tener Node.js instalado en su máquina. De lo contrario, descárguelo e instálelo desde [nodejs.org](https://nodejs.org/).

### <a name="install-yarn"></a> Instalar Yarn

Yarn es un administrador de paquetes para Node.js. Si aún no ha instalado Yarn, puede hacerlo siguiendo las instrucciones en [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### <a name="install-node-dependencies"></a> Instalar Node Dependencies

Navegue al directorio de su proyecto e instale las dependencias de Node usando Yarn:

```bash
cd hydra
yarn
```

### <a name="install-python-39"></a> Instalar Python 3.9

Asegúrese de tener Python 3.9 instalado en su máquina. Puede descargarlo e instalarlo desde [python.org](https://www.python.org/downloads/release/python-3919/).

### <a name="install-python-dependencies"></a> Instalar Python Dependencies

Instale las dependencias requeridas de Python usando pip:

```bash
pip install -r requirements.txt
```

## <a name="environment-variables"></a> Variables de entorno

Necesitará una clave API de SteamGridDB para recuperar los íconos del juego durante la instalación.
Si desea tener onlinefix como reempaquetador, deberá agregar sus credenciales al archivo .env.

Una vez que lo tenga, puede copiar o cambiar el nombre del archivo `.env.example` a `.env` y ponerlo en `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## <a name="running"></a> Corriendo

Una vez que haya configurado todo, puede ejecutar el siguiente comando para iniciar tanto el proceso Electron como el cliente bittorrent:

```bash
yarn dev
```

## <a name="build"></a> Construir

### <a name="build-the-bittorrent-client"></a> Construya el cliente bittorrent

Compile el cliente BitTorrent usando este comando

```bash
python torrent-client/setup.py build
```

### <a name="build-the-electron-application"></a> Cree la aplicación Electron

Compile una aplicación Electron usando este comando:

En el Windows:

```bash
yarn build:win
```

En el Linux:

```bash
yarn build:linux
```

## <a name="contributors"></a> Colaboradores

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## <a name="licencia"></a> Licencia

El Hydra tiene la licencia [Licencia MIT](LICENSE).
