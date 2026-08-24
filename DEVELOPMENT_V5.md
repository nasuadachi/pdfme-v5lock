# Development Guide (v5)

PdfMe 5.5.10からフォーク  
6系で私が必要と思われるパッチを当てていく  
mac osのみテストしています

## v5固有差分をupstreamからマージするときの確認事項

v5lock固有のバックポートには、コード内に `V5LOCK-BACKPORT-...` 形式の識別子を付けています。
upstreamをマージするときは、次のコマンドで意図的な差分を先に確認してください。

```bash
rg "V5LOCK-BACKPORT" packages DEVELOPMENT_V5.md
```

### V5LOCK-BACKPORT-20260825-PDFJS-WORKER-ASSET

- 対象: `packages/converter/src/index.browser.ts`
- 症状: Angularの本番バンドルで`pdf2img`または`pdf2size`を呼ぶと、PDF.js Workerの取得に失敗する
- 原因: `pdfjs-dist/legacy/build/pdf.worker.mjs`を`import.meta.url`から解決すると裸の`.mjs` URLが残り、Amplify HostingのSPA rewriteによりそのURLへ`index.html`が返る
- v5lockでの修正: Subkarte / management-appがビルド時に配置する`assets/pdfjs/pdf.worker.min.js`を、`document.baseURI`基準で既定Workerとして使用する
- メモリ方針: Workerをdata URLとしてConverterへ埋め込まず、低メモリiPadのメインバンドルへWorker文字列を常駐させない

### V5LOCK-BACKPORT-20260824-MVT-PROP-PANEL-ORDER

- 対象: `packages/schemas/src/multiVariableText/propPanel.ts`
- 回帰テスト: `packages/schemas/__tests__/multiVariableTextPropPanel.test.ts`
- 症状: Designerで用紙テンプレートを新規作成すると、`Failed to find Ant form placeholder row to create dynamic variables inputs.` で初期化が失敗する
- 原因: 同期widget描画では、`mapDynamicVariables` が後続のプレースホルダーフィールドより先に呼ばれる場合がある
- v5lockでの修正: 同じフォーム内に検索範囲を限定し、プレースホルダーがまだなければ現在の描画スタック後に一度だけ再試行する

downstreamのsubkarteがv5lock修正版へ切り替わったら、subkarte側の `patches/@pdfme+schemas+5.5.11-v5lock.7.patch` は二重適用を避けるため削除する。

確認コマンド:

```bash
npm run -w packages/schemas test -- --runTestsByPath __tests__/multiVariableTextPropPanel.test.ts --runInBand
npm run build:schemas
```

### V5LOCK-BACKPORT-20260810-PAGE-CURSOR

- 対象: `packages/ui/src/hooks.ts` の `useScrollPageCursor`
- 回帰テスト: `packages/ui/__tests__/hooks.test.tsx`
- 症状: Designerが画面上部以外に配置されていると、次ページボタンの1回目はページがグレーになるだけで、2回目にページ移動する
- 原因: スクロールコンテナ内の相対座標 `scrollTop` に、viewport座標の `getBoundingClientRect().top` を加えてページ境界を計算していた
- v5lockでの修正: ページ境界をスクロールコンテナ内の座標だけで計算する
- upstreamとの関係: v6系では各ページの可視面積を使う `getMostVisiblePageIndex` 方式へ置き換えられている

マージ時の扱い:

1. マージ後も旧 `useScrollPageCursor` が残る場合は、このバックポートと回帰テストを維持する。
2. v6系の可視面積方式が取り込まれた場合は、回帰テストが成功することを確認してから、このバックポート部分だけを削除してよい。
3. downstreamのsubkarteがv5lock修正版へ切り替わったら、subkarte側の `patches/@pdfme+ui+5.5.10.patch` は二重適用を避けるため削除する。

確認コマンド:

```bash
npm run -w packages/ui test -- --runTestsByPath __tests__/hooks.test.tsx --runInBand
npm run build:ui
```

### V5LOCK-BACKPORT-20260823-SAFARI-PINCH-STABILITY

- 対象: `packages/ui/src/class.ts`, `packages/ui/src/hooks.ts`, `packages/ui/src/components/Preview.tsx`, `packages/ui/src/components/Renderer.tsx`
- 回帰テスト: `packages/ui/__tests__/hooks.test.tsx`, `packages/ui/__tests__/components/Renderer.test.tsx`
- 症状: iPad Safari のネイティブピンチで Form のコンテナ寸法が通知されると、PDF 背景の再変換と plugin `ui()` の再実行が連鎖し、Fabric Canvas が破棄・再生成される
- 原因: viewport との交差寸法を layout size として扱い、`size` を PDF 前処理・schema 初期化・plugin DOM の再生成依存に含めていた
- v5lockでの修正:
  1. ResizeObserver の layout box を使用し、同じ寸法の通知では `render()` しない
  2. PDF 前処理を `template` / `maxZoom` の変更に限定し、`scale` は保持済み `pageSizes` と現在の `size` から同期計算する
  3. Preview の schema 初期化を `template` / `inputs` の変更に限定する
  4. `uninterruptedEditMode` plugin は Form / Viewer でも scale-only 変更時に既存 DOM を維持する

downstream の Fabric plugin は `uninterruptedEditMode: true` を指定する。これにより実際の template、value、schema、options 変更では従来どおり `ui()` を再実行し、scale-only 変更だけを非破壊に扱う。

確認コマンド:

```bash
npm run -w packages/ui test -- --runTestsByPath __tests__/hooks.test.tsx __tests__/components/Renderer.test.tsx --runInBand
npm run build:ui
```

## 環境要件

- **Node.js**: v22.17.0 を推奨
- **npm**: Node.js v22 に付属する版を使用
- **macOS (ARM64) の場合**: ネイティブ依存ライブラリのインストールが必要

補足:

- このリポジトリは Node.js v22.17.0 でビルドとテストを確認しています
- Node.js v25 など別メジャーで作業した場合は、`canvas` のような native 依存を再インストールする必要があります
- 同じ `node_modules` を別メジャーの Node.js で使い回すと、ABI 不一致でテストが落ちます

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

| パッケージ           | 説明                                |
| -------------------- | ----------------------------------- |
| `@pdfme/common`      | 共通型、ヘルパー、スキーマ定義      |
| `@pdfme/pdf-lib`     | pdf-lib 用のラッパー                |
| `@pdfme/converter`   | PDF と画像の相互変換                |
| `@pdfme/schemas`     | テンプレートスキーマ                |
| `@pdfme/generator`   | PDF 生成エンジン                    |
| `@pdfme/manipulator` | PDF の操作（ページ追加・削除など）  |
| `@pdfme/ui`          | React コンポーネント（エディタ UI） |
