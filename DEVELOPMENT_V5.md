# Development Guide (v5)

PdfMe 5.5.10からフォーク  
6系で私が必要と思われるパッチを当てていく  
mac osのみテストしています  

## 環境要件

- **Node.js**: v22 以上（推奨 v20 LTS / v22 LTS）
- **npm**: v9 以上
- **macOS (ARM64) の場合**: ネイティブ依存ライブラリのインストールが必要

## セットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/nasuadachi/pdfme-v5lock.git
cd pdfme-v5lock
```

### 2. ネイティブ依存ライブラリのインストール（macOS）

`canvas` パッケージのビルドに以下のライブラリが必要です：

```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

### 3. 依存パッケージのインストール

```bash
npm install
```

`postinstall` スクリプトにより、ワークスペース間のリンクが自動設定されます。

## ビルド

全パッケージをビルドします：

```bash
npm run build
```

ビルド順序は依存関係に基づいています：
1. `clean` - 全パッケージの dist ディレクトリを削除
2. `pdf-lib` → `common` → `converter` → `schemas` （順次）
3. `generator` / `ui` / `manipulator` （並列）

個別パッケージのビルド：

```bash
npm run build:common
npm run build:generator
npm run build:ui
# など
```

## テスト

全パッケージのテストを実行：

```bash
npm run test
```

## 開発（ウォッチモード）

変更をリアルタイムで反映するには、各パッケージで `npm run dev` を実行します：

```bash
# 別々のターミナルで実行
npm run -w packages/common dev
npm run -w packages/schemas dev
npm run -w packages/generator dev
npm run -w packages/ui dev
```

## Playground（ブラウザでの確認）

変更をブラウザで確認するには playground を使用します：

```bash
cd playground
npm install
npm run dev
```

各パッケージで `npm run dev` が実行されている状態では、コードの変更が playground に反映されます（UI パッケージは 5-10 秒かかる場合があります）。

## リンット・フォーマット

```bash
npm run lint
npm run prettier
```

## パッケージ構成

| パッケージ | 説明 |
|---|---|
| `@pdfme/common` | 共通型、ヘルパー、スキーマ定義 |
| `@pdfme/pdf-lib` | pdf-lib 用のラッパー |
| `@pdfme/converter` | PDF と画像の相互変換 |
| `@pdfme/schemas` | テンプレートスキーマ |
| `@pdfme/generator` | PDF 生成エンジン |
| `@pdfme/manipulator` | PDF の操作（ページ追加・削除など） |
| `@pdfme/ui` | React コンポーネント（エディタ UI） |
