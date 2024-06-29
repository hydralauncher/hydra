<br>

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://hydralauncher.site)

  <h1 align="center">Hydra Launcher</h1>
  
  <p align="center">
    <strong>Hydra es un launcher de juegos con su propio cliente de bittorrent y gestor propio de repacks.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

[![be](https://img.shields.io/badge/lang-be-orange)](README.be.md)
[![pl](https://img.shields.io/badge/lang-pl-white)](README.pl.md)
[![pt-BR](https://img.shields.io/badge/lang-pt--BR-green.svg)](README.pt-BR.md)
[![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](README.ru.md)
[![uk-UA](https://img.shields.io/badge/lang-uk--UA-blue)](README.uk-UA.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![fr](https://img.shields.io/badge/lang-fr-blue)](README.fr.md)

![Hydra Catalogue](./docs/screenshot.png)

</div>

## Tabla de Contenidos

- [Acerca de](#acerca-de)
- [Características](#caracteristicas)
- [Instalación](#Instalacion)
- [Contribuir](#contribuir)
  - [Únete a nuestro Telegram](#unete-a-nuestro-telegram)
  - [Haz un fork y clona tu repositorio](#haz-un-fork-y-clona-tu-repositorio)
  - [Maneras en las que puedes contribuir](#maneras-en-las-que-puedes-contribuir)
  - [Estructura del proyecto](#estructura-del-proyecto)
- [Compilar desde el código fuente](#compilar-desde-el-código-fuente)
  - [Instalar Node.js](#instalar-nodejs)
  - [Instalar Yarn](#instalar-yarn)
  - [Instalar Dependencias de Node](#instalar-dependencias-de-node)
  - [Instalar Python 3.9](#instalar-python-39)
  - [Instalar Dependencias de Python](#Instalar-dependencias-de-python)
- [Variables del Entorno](#variables-del-entorno)
- [Ejecución](#ejecucion)
- [Compilación](#compilacion)
  - [Compilar el cliente de bittorrent](#compilar-el-cliente-de-bittorrent)
  - [Compilar la aplicación Electron](#compilar-la-aplicacion-electron)
- [Colaboradores](#colaboradores)

## Acerca de

**Hydra** es un **Launcher de Juegos** con su propio **Cliente Bittorrent** y **autogestor de Repacks**.
<br>
El launcher está escrito en TypeScript (Electron) y Python, el cuál se encarga del sistema de torrent usando libtorrent.

## Caracteristicas

- Buscador e instalador autogestionado de repacks a través de las páginas más confiables en él [Megahilo](https://www.reddit.com/r/Piracy/wiki/megathread/)
- Cliente propio de bittorrent integrado
- Integración de How Long To Beat (HLTB) en la página del juego
- Customización de rutas de descargas
- Notificaciones en actualizaciones a listas de repacks
- Soporte a Windows y Linux
- En constante actualización
- Y mucho más ...

## Instalacion

Sigue los pasos de abajo para instalar:

1. Descarga la última versión de Hydra desde la página de [Releases](https://github.com/hydralauncher/hydra/releases/latest).
   - Descarga solo el .exe si quieres instalar Hydra en Windows.
   - Descarga el .deb o .rpm o .zip si quieres instalar Hydra en Linux. (Depende de tu distro de Linux)
2. Ejecuta el archivo descargado.
3. ¡Disfruta de Hydra!

## <a name="contribuir"> Contribuir

### <a name="unete-a-nuestro-telegram"></a> Unete a nuestro Telegram

Puedes unirte a nuestra conversación y discusiones en nuestro canal de [Telegram](https://t.me/hydralauncher).

### Haz un fork y clona tu repositorio

1. Realiza un fork del repositorio [(Haz click acá para hacer un fork ahora)](https://github.com/hydralauncher/hydra/fork)
2. Clona el código forkeado `git clone https://github.com/tu_nombredeusuario/hydra`
3. Crea una nueva rama
4. Sube tus commits
5. Envía nuevas solicitudes de pull

### Maneras en las que puedes contribuir

- Traducción: Queremos que Hydra esté disponible para todas las personas que sean posible. Siéntete libre de ayudarnos a traducirlo a nuevos lenguajes o actualizar y mejorar las ya disponibles en Hydra.
- Código: Hydra está hecho con Typescript, Electron y un poquito de Python. Si quieres contribuir, ¡únete a nuestro [Telegram](https://t.me/hydralauncher)!

### Estructura del proyecto

- torrent-client: Usamos libtorrent, una librería de Python que se encarga de manejar las descargas torrent
- src/renderer: El UI de la aplicación
- src/main: El resto de la lógica va acá.

## Compilar desde el código fuente

### Instalar Node.js

Asegúrate que tienes Node.js instalado en tú máquina. Si no es así, puedes descargarlo e instalarlo desde [nodejs.org](https://nodejs.org/).

### Instalar Yarn

Yarn es un gestor de paquetes para Node.js. Si no tienes aún instalado Yarn todavía, puedes hacerlo siguiendo las instrucciones en [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### Instalar Dependencias de Node

Dirígete hasta el directorio del proyecto e instala las dependencias de Node usando Yarn:

```bash
cd hydra
yarn
```

### Instalar Python 3.9

Asegúrate que tienes Python 3.9 instalado en tu máquina. Puedes descargarlo e instalarlo desde [python.org](https://www.python.org/downloads/release/python-3913/).

### Instalar Dependencias de Python

Instala las dependencias de Python requeridas usando pip:

```bash
pip install -r requirements.txt
```

## Variables del Entorno

Necesitas una llave API de SteamGridDB para así poder obtener los íconos de los juegos en la instalación.
Si quieres también tener los repacks de onlinefix, necesitarás añadir tus credenciales al .env

Una vez que los tengas, puedes copiar o renombrar el archivo `.env.example` cómo `.env` y colocarlo en `STEAMGRIDDB_API_KEY`, `ONLINEFIX_USERNAME`, `ONLINEFIX_PASSWORD`.

## Ejecucion

Una vez que tengas todas las cosas listas, puedes ejecutar el siguiente comando para así iniciar el proceso de Electron y el cliente de bittorrent:

```bash
yarn dev
```

## Compilacion

### Compilar el cliente de bittorrent

Crea el cliente bittorrent usando este comando:

```bash
python torrent-client/setup.py build
```

### Compilar la aplicacion Electron

Crea la aplicación de Electron usando este comando:

En Windows:

```bash
yarn build:win
```

En Linux:

```bash
yarn build:linux
```

## Colaboradores

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## Licencia

Hydra está licenciado bajo la [MIT License](LICENSE).
