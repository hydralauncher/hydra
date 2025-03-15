<br>

<div align="center">

[<img src="../resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra, kendi gömülü BitTorrent istemcisine sahip bir oyun başlatıcısıdır.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

[![pt-BR](https://img.shields.io/badge/lang-pt--BR-green.svg)](README.pt-BR.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](../README.md)
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
[![ee](https://img.shields.io/badge/lang-et-blue.svg)](README.et.md)
[![tr](https://img.shields.io/badge/lang-tr-red.svg)](README.tr.md)

![Hydra Catalogue](screenshot.png)

</div>

## <a name="içindekiler"></a> İçindekiler

- [İçindekiler](#içindekiler)
- [Hakkında](#hakkında)
- [Özellikler](#özellikler)
- [Kurulum](#kurulum)
- [Katkıda bulunma](#katkıda-bulunma)
  - [Telegram grubumuza katılın](#telegram-katıl)
  - [Repoyu forklayın ve klonlayın](#repo-fork-klon)
  - [Katkıda bulunabileceğin yollar](#katkı-yolları)
  - [Proje yapısı](#proje-yapısı)
- [Kaynak kodundan derleme](#kaynak-kodundan-derleme)
  - [Node.js'i yükleme](#nodejs-yükle)
  - [Yarn'ı yükleme](#yarn-yükle)
  - [Node bağımlılıklarını yükleme](#node-bağımlılık-yükle)
  - [OpenSSL 1.1'i yükleme](#openssl-1-1-yükle)
  - [Python 3.9'u yükleme](#python-3-9-yükle)
  - [Python bağımlılıklarını yükleme](#python-bağımlılık-yükle)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [Çalıştırma](#çalıştırma)
- [Derleme](#derleme)
  - [BitTorrent istemcisini derleme](#bittorrent-istemci-derle)
  - [Electron uygulamasını derleme](#electron-uygulama-derle)
- [Katkıda bulunanlar](#katkıda-bulunanlar)
- [Lisans](#lisans)

## <a name="hakkında"></a> Hakkında

**Hydra**, kendi gömülü **BitTorrent istemci**sine sahip bir **oyun başlatıcısı**dır.
<br>
Başlatıcı, torrent sistemini libtorrent kullanarak yöneten Python ve TypeScript (Electron) ile yazılmıştır.

## <a name="özellikler"></a> Özellikler

- Kendi gömülü BitTorrent istemcisi
- Oyun sayfasında How Long To Beat (HLTB) entegrasyonu
- İndirme yolu özelleştirmesi
- Windows ve Linux desteği
- Sürekli güncelleme
- Ve daha fazlası...

## <a name="kurulum"></a> Kurulum

Aşağıdaki adımları izleyerek Hydra'yı kurun:

1. Hydra'nın en son sürümünü [Releases](https://github.com/hydralauncher/hydra/releases/latest) sayfasından indirin.
   - Hydra'yı Windows'a kurmak istiyorsanız sadece .exe dosyasını indirin.
   - Hydra'yı Linux'a kurmak istiyorsanız .deb, .rpm veya .zip dosyasını indirin (kullandığınız Linux dağıtımına bağlı olarak).
2. İndirilen dosyayı çalıştırın.
3. Hydra'nın keyfini çıkarın!

## <a name="katkıda-bulunma"></a> Katkıda Bulunma

### <a name="telegram-katıl"></a> Telegram grubumuza katılın

Tartışmalarımızı [Telegram](https://t.me/hydralauncher) kanalımız üzerinde yürütüyoruz.

### <a name="repo-fork-klon"></a> Repoyu forklayın ve klonlayın

1. Depoyu fork'layın [(şimdi forklamak için tıklayın)](https://github.com/hydralauncher/hydra/fork)
2. Forkladığınız kodu klonlayın `git clone https://github.com/kullanıcı_adınız/hydra`
3. Yeni bir branch oluşturun
4. Commitlerinizi gönderin (push)
5. Yeni bir Pull Request gönderin

### <a name="katkı-yolları"></a> Katkıda bulunabileceğin yollar

- Çeviri: Hydra'nın mümkün olduğunca fazla kişiye ulaşmasını istiyoruz. Yeni dillere çeviri yapmak ya da mevcut dillere güncelleme ve iyileştirme yapmak için yardımcı olmaktan çekinmeyin.
- Kod: Hydra, Typescript, Electron ve biraz Python ile inşa edilmiştir. Katkıda bulunmak isterseniz, [Telegram](https://t.me/hydralauncher) kanalımıza katılın!

### <a name="proje-yapısı"></a> Proje yapısı

- torrent-client: Torrent indirmelerini yönetmek için libtorrent adlı bir Python kütüphanesini kullanıyoruz.
- src/renderer: Uygulamanın kullanıcı arayüzü burada bulunur.
- src/main: Uygulamanın tüm işleyişi ve iş mantığı bu bölümde bulunur.

## <a name="kaynak-kodundan-derleme"></a> Kaynak kodundan derleme

### <a name="nodejs-yükle"></a> Node.js'i yükleme

Makinenizde Node.js'in yüklü olduğundan emin olun. Yüklü değilse, [nodejs.org](https://nodejs.org/) adresinden indirip kurun.

### <a name="yarn-yükle"></a> Yarn'ı yükleme

Yarn, Node.js için bir paket yöneticisidir. Eğer Yarn'ı henüz kurmadıysanız, [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/) adresindeki talimatları izleyerek kurabilirsiniz.

### <a name="node-bağımlılık-yükle"></a> Node bağımlılıklarını yükleme

Proje dizinine gidin ve Yarn kullanarak Node bağımlılıklarını yükleyin:

```bash
cd hydra
yarn
```

### <a name="openssl-1-1-yükle"></a> OpenSSL 1.1'i yükleme

Windows ortamlarında libtorrent tarafından gerekli olan [OpenSSL 1.1](https://slproweb.com/download/Win64OpenSSL-1_1_1w.exe)'i indirip yükleyin.

### <a name="python-3-9-yükle"></a> Python 3.9'u yükleme

Makinenizde Python 3.9'un yüklü olduğundan emin olun. Bunu [python.org](https://www.python.org/downloads/release/python-3913/) adresinden indirip kurarak yapabilirsiniz.

### <a name="python-bağımlılık-yükle"></a> Python bağımlılıklarını yükleme

Gerekli Python bağımlılıklarını pip kullanarak yükleyin:

```bash
pip install -r requirements.txt
```

## <a name="ortam-değişkenleri"></a> Ortam değişkenleri

Oyun simgelerini yüklemek için bir SteamGridDB API Anahtarına ihtiyacınız olacak.

Bu anahtara sahip olduktan sonra, `.env.example` dosyasını kopyalayabilir veya adını `.env` olarak değiştirebilir ve `STEAMGRIDDB_API_KEY` değerini buraya ekleyebilirsiniz.

## <a name="çalıştırma"></a> Çalıştırma

Tüm ayarları tamamladıktan sonra, hem Electron sürecini hem de bittorrent istemcisini başlatmak için aşağıdaki komutu çalıştırabilirsiniz:

```bash
yarn dev
```

## <a name="derleme"></a> Derleme

### <a name="bittorrent-istemci-derle"></a> BitTorrent istemcisini derleme

Bittorrent istemcisini aşağıdaki komutla derleyin:

```bash
python torrent-client/setup.py build
```

### <a name="electron-uygulama-derle"></a> Electron uygulamasını derleme

Electron uygulamasını aşağıdaki komutlarla derleyebilirsiniz:

Windows'ta:

```bash
yarn build:win
```

Linux'ta:

```bash
yarn build:linux
```

## <a name="katkıda-bulunanlar"></a> Katkıda bulunanlar

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## <a name="lisans"></a> Lisans

Hydra, [MIT Lisansı](https://github.com/hydralauncher/hydra/blob/main/LICENSE) altında lisanlanmıştır.
