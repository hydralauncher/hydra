# Hydra Launcher

<div align="center">

[<img src="./resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

<h1 align="center">Hydra Launcher</h1>

<p align="center">
    <strong>Hydra هو مشغل ألعاب يحتوي على عميل BitTorrent مدمج خاص به.</strong>
</p>

[![البناء](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![الإصدار](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

[![pt-BR](https://img.shields.io/badge/lang-pt--BR-green.svg)](./docs/README.pt-BR.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](./README.md)
[![ru](https://img.shields.io/badge/lang-ru-yellow.svg)](./docs/README.ru.md)
[![uk-UA](https://img.shields.io/badge/lang-uk--UA-blue)](./docs/README.uk-UA.md)
[![be](https://img.shields.io/badge/lang-be-orange)](./docs/README.be.md)
[![es](https://img.shields.io/badge/lang-es-red)](./docs/README.es.md)
[![fr](https://img.shields.io/badge/lang-fr-blue)](./docs/README.fr.md)
[![de](https://img.shields.io/badge/lang-de-black)](./docs/README.de.md)
[![ita](https://img.shields.io/badge/lang-it-red)](./docs/README.it.md)
[![cs](https://img.shields.io/badge/lang-cs-purple)](./docs/README.cs.md)
[![da](https://img.shields.io/badge/lang-da-red)](./docs/README.da.md)
[![nb](https://img.shields.io/badge/lang-nb-blue)](./docs/README.nb.md)
[![ee](https://img.shields.io/badge/lang-et-blue.svg)](./docs/README.et.md)

![كتالوج Hydra](./docs/screenshot.png)

</div>

## جدول المحتويات

- [جدول المحتويات](#جدول-المحتويات)
- [نبذة عن البرنامج](#نبذة-عن-البرنامج)
- [المميزات](#المميزات)
- [التثبيت](#التثبيت)
- [المساهمة](#المساهمة)
  - [انضم إلى Telegram](#انضم-إلى-Telegram)
  - [تفرّع واستنسخ مستودعك](#تفرّع-واستنسخ-مستودعك)
  - [طرق المساهمة](#طرق-المساهمة)
  - [هيكل المشروع](#هيكل-المشروع)
- [البناء من المصدر](#البناء-من-المصدر)
  - [تثبيت Node.js](#تثبيت-Node.js)
  - [تثبيت Yarn](#تثبيت-Yarn)
  - [تثبيت الاعتماديات الخاصة بـ Node](#تثبيت-الاعتماديات-الخاصة-ب-Node)
  - [تثبيت Python 3.9](#تثبيت-Python-3.9)
  - [تثبيت اعتماديات Python](#تثبيت-اعتماديات-Python)
- [متغيرات البيئة](#متغيرات-البيئة)
- [التشغيل](#التشغيل)
- [البناء](#البناء)
  - [بناء عميل BitTorrent](#بناء-عميل-BitTorrent)
  - [بناء تطبيق Electron](#بناء-تطبيق-Electron)
- [المساهمون](#المساهمون)
- [الترخيص](#الترخيص)

## نبذة عن البرنامج

**Hydra** هو **مشغل ألعاب** يتضمن **عميل BitTorrent مدمج**.  
<br>
تمت كتابة المشغل باستخدام TypeScript (Electron) وPython، حيث يتم استخدام مكتبة libtorrent لإدارة النظام الخاص بالتورنت.

## المميزات

- عميل BitTorrent مدمج
- تكامل مع **How Long To Beat (HLTB)** على صفحات الألعاب
- تخصيص مسارات التحميل
- دعم لنظامي Windows وLinux
- تحديثات مستمرة
- المزيد...

## التثبيت

لتثبيت Hydra، اتبع الخطوات التالية:

1. قم بتنزيل أحدث إصدار من Hydra من صفحة [الإصدارات](https://github.com/hydralauncher/hydra/releases/latest).  
   - قم بتنزيل ملف .exe لتثبيت Hydra على Windows.
   - قم بتنزيل .deb أو .rpm أو .zip لتثبيت Hydra على Linux (حسب توزيع Linux الخاص بك).
2. قم بتشغيل الملف الذي تم تنزيله.
3. استمتع باستخدام Hydra!

## المساهمة

### انضم إلى Telegram

يمكنك الانضمام إلى قناة [Telegram](https://t.me/hydralauncher) الخاصة بنا للمشاركة في النقاشات.

### تفرّع واستنسخ مستودعك

1. قم بتفرّع المستودع [(اضغط هنا للتفرّع الآن)](https://github.com/hydralauncher/hydra/fork).  
2. استنسخ الكود باستخدام الأمر التالي:
   ```bash
   git clone https://github.com/your_username/hydra
   ```
3. قم بإنشاء فرع جديد.
4. ارفع تعديلاتك.
5. قدّم طلب دمج جديد.

### طرق المساهمة

- **الترجمة**: نرغب في جعل Hydra متاحًا لأكبر عدد ممكن من الأشخاص. يمكنك المساعدة بترجمة التطبيق إلى لغات جديدة أو تحسين الترجمات الحالية.
- **الكود**: تم بناء Hydra باستخدام TypeScript وElectron وبعض الأكواد المكتوبة بـ Python. إذا كنت ترغب بالمساهمة، انضم إلى قناتنا على [Telegram](https://t.me/hydralauncher)!

### هيكل المشروع

- **torrent-client**: مكتبة libtorrent المكتوبة بـ Python لإدارة التنزيلات عبر التورنت.
- **src/renderer**: واجهة المستخدم للتطبيق.
- **src/main**: يحتوي على المنطق الخاص بالتطبيق.

## البناء من المصدر

### تثبيت Node.js

تأكد من تثبيت Node.js على جهازك. إذا لم يكن مثبتًا، يمكنك تنزيله وتثبيته من [nodejs.org](https://nodejs.org/).

### تثبيت Yarn

Yarn هو مدير حزم لـ Node.js. إذا لم تقم بتثبيته مسبقًا، يمكنك اتباع التعليمات الموجودة على [yarnpkg.com](https://classic.yarnpkg.com/lang/en/docs/install/).

### تثبيت الاعتماديات الخاصة بـ Node

انتقل إلى مجلد المشروع وقم بتثبيت الاعتماديات باستخدام Yarn:

```bash
cd hydra
yarn
```

### تثبيت Python 3.9

تأكد من تثبيت Python 3.9 على جهازك. يمكنك تنزيله وتثبيته من [python.org](https://www.python.org/downloads/release/python-3913/).

### تثبيت اعتماديات Python

قم بتثبيت الاعتماديات المطلوبة باستخدام pip:

```bash
pip install -r requirements.txt
```

## متغيرات البيئة

ستحتاج إلى مفتاح API من SteamGridDB لجلب أيقونات الألعاب أثناء التثبيت.  
بعد الحصول عليه، قم بنسخ أو إعادة تسمية ملف `.env.example` إلى `.env`، ثم قم بإضافة المفتاح في متغير `STEAMGRIDDB_API_KEY`.

## التشغيل

بمجرد إعداد كل شيء، يمكنك تشغيل التطبيق باستخدام الأمر التالي:

```bash
yarn dev
```

## البناء

### بناء عميل BitTorrent

استخدم الأمر التالي لبناء عميل BitTorrent:

```bash
python torrent-client/setup.py build
```

### بناء تطبيق Electron

استخدم الأوامر التالية لبناء تطبيق Electron:

**على Windows**:

```bash
yarn build:win
```

**على Linux**:

```bash
yarn build:linux
```

## المساهمون

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## الترخيص

Hydra مرخص بموجب [رخصة MIT](LICENSE).
