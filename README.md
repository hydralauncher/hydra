<div align="center">

[<img src="https://raw.githubusercontent.com/apxllo123/medusa/refs/heads/main/resources/icon.png?v=3" width="144"/>](https://github.com/apxllo123/medusa)

  <h1 align="center">Medusa Launcher</h1>

  <p align="center">
    <strong>Medusa Launcher is an open-source gaming platform created to be the single tool that you need in order to manage your gaming library. Medusa is written in Node.js (Electron, React, Typescript), Python, and Rust.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/apxllo123/medusa/%EF%A3%BFbuild.yml)](https://github.com/apxllo123/medusa/actions/workflows/%EF%A3%BFbuild.yml)
[![release](https://img.shields.io/github/package-json/v/apxllo123/medusa)](https://github.com/apxllo123/medusa/releases)

![Medusa Launcher Home Page](./docs/screenshot.png)

</div>

## Features

- Add games that you own to your library
- Have a nice profile that shows what you are playing to your friends
- Save your game progress in the cloud with Medusa Cloud
- Unlock achievements
- Navigate through a rich catalogue with a powerful suggestion algorithm
- Discover new games that you haven't played before

## Build from source and contributing

Please, refer to our Documentation pages: [docs.medusalauncher.gg](https://docs.medusalauncher.gg/getting-started)

### Local development requirements

- Node.js + Yarn
- Python 3.9+ with `pip install -r requirements.txt`
- Rust toolchain (for `medusa-native`)

After installing dependencies, `postinstall` now builds the Rust native addon automatically (`medusa-native/medusa-native.node`).

Packaging scripts (`yarn build:mac`, `yarn build:unpack`) now run `yarn build:python-rpc` automatically.

## Contributors

<a href="https://github.com/apxllo123/medusa/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=apxllo123/medusa" />
</a>

## License

Medusa is licensed under the [MIT License](LICENSE).
