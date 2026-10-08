# Development Guide (v5)

PdfMe 5.5.10からフォーク  
6系で私が必要と思われるパッチを当てていく  
主にmacOSでテストしています。Safariの行頭BackspaceのイベントはiPadOSシミュレーターでも確認しています（iPad実機は別途確認）。

## v5lock独自機能: 本文を次の入力欄へ送る（v5lock.10）

識別名: `V5LOCK-CUSTOM-20261005-TEXT-FLOW`。これは本家v5のText/Formにはない、subkarteのノート・書類向けの追加機能です。バックポートではなく、このフォークで独自実装しています。詳細とAPI例は [TEXT_FLOW.md](TEXT_FLOW.md) を参照してください。

| 項目 | 本家v5の動作 | v5lockの追加動作（有効化したFormのみ） |
| --- | --- | --- |
| 本文入力 | 各text欄を独立して編集し、基本的にblurで変更通知 | 入力・貼り付け・実際の改行を伴う音声入力を処理し、同じページ内の後続欄へ分配 |
| 対象と順序 | 本文の段番号・上限という名前規則はない | `type: "text"` の編集可能な `textN` / `textN-上限` を数値の行番号順に使用。ゼロ埋めは保持 |
| 上限 | dynamicFontSizeなどによる欄内の文字サイズ調整 | 未指定20、移動先の欄ごとの上限。ASCII・半角カナ0.5、全角・CJK・絵文字1。書記素の途中で切らない |
| 改行と既存本文 | 一つの欄の中に保持 | 明示改行で段を分け、長い行をさらに分割。空行は詰め、後続の既存本文は下へ押し出す。空段の削除時は後続本文を繰り上げる |
| 保存済みの長文 | 欄内で保持 | 読み込み時に上限超過・改行入りだった本文は、編集後も分割せず保持 |
| 旧項目名の保存データ | 完全な項目名のキーを参照 | 現在キーが無い場合だけ、末尾の上限を除いた旧キーを補完。現在キーの空文字を優先し、旧キーや対象外の値も保持 |
| 複数欄の更新 | setInputsによる再描画 | 入力DOMを保持して一括確定し、その後にonChangeInputを通知。IME確定まで分配・フォーカス移動を待つ |
| 容量超過 | 段間分配なし | 新しい入力自体が収まらなければ全体を取消。既存末尾の破棄は操作前の永続保存が成功した場合だけ許可。失敗時は本文を戻す |

### 有効化・保存・PDF出力

- `options.textFlow.enabled: true` で有効化。新しいschema.typeやテンプレート属性への移行は不要です。無効なFormと対象外の欄は従来の入力経路を使います。
- 日付・担当者などは移動せず、本文だけを移動します。ページをまたがず、そのページの最後の対象欄で容量を判定します。
- `onBeforeDiscard` は操作前の固定snapshotを受け取り、永続保存の成功後に完了します。保存待ち中の暫定本文と公開入力値を分離し、後続入力を順番に確定します。保存失敗時は待機中の本文操作を取り消し、独立した対象外欄の編集は保持します。
- `Form.whenInputsSettled()` を追加しました。通常の保存・PDF出力・画面離脱はこれを待ってから入力値を取得します。押し出し前の保存hook自身は待機せず、渡されたsnapshotを保存します。
- 本文のUndo/Redoは複数段を一つの操作として扱います。通知用の `onNotice` も追加しています。
- 旧キー補完はForm/Viewerの読み込みとGeneratorの必須項目検査前に共通適用します。Generatorでも `options.textFlow.enabled: true` を指定します。保存・PDF生成には現在の項目名を使います。

### v5lock.12の修正（issue #698 の追加要望）

- 自動折返しでつながった本文を、途中の行への挿入・削除後に再分配します。挿入で増えた文字は後続行へ押し出し、削除で空いた幅には後続行の文字を繰り上げます。明示改行で分けた段落は連結しません。
- 自動折返しの境界を入力値の `__pdfme_text_flow_soft_after` にページの対象欄構成とともに記録します。フォームの保存・再読み込み・Undo/Redoで境界を引き継ぎます。このキーは表示欄ではなく、PDFの本文描画にも使いません。
- 既存の保存データには境界の区別がないため、メタデータがない行はすべて独立した段落として扱います。20文字ちょうどで終わる既存行も自動的には次行と連結しません。
- 入力した文字自体がページに収まらない場合は操作を取り消します。再分配によって既存の末尾本文が押し出される場合は、従来の `onBeforeDiscard` で操作前の入力値と履歴を保存してから確定します。IME中のDOMとフォーカスを保持します。
- Commonの分配計算、UIの状態管理、Formの確定値・変更通知、Textの遅延入力とカーソルを回帰テストで確認します。公開前にローカルtarballをsubkarteで検証し、その後で7パッケージを同一版のGitHub Releaseへ載せます。

### 開発中の追加修正: 次段の行頭で Backspace

- 2段目以降の先頭で Backspace を押すと、前段末尾の1書記素を削除し、現在の段の本文を前の段落へ連結して上限に従い再分配します。たとえば前段が `甲乙丙欄`、次段が `だけです`、上限4文字なら、操作後は `甲乙丙だ` / `けです` となり、カーソルは `だ` の直前へ移ります。
- 現在の段が完全に空欄でも、行頭の Backspace は前段末尾の1書記素を削除し、カーソルを前段の削除位置へ移します。空欄は詰め、さらに下の既存本文があれば上へ繰り上げます。前段が1文字だけの場合は削除位置の0文字目へカーソルを移します。
- 自動折返しだけでなく、明示改行やメタデータのない保存済み行も、この Backspace 操作をした場合に限って連結します。通常の再分配では独立した段落として扱う従来の仕様を維持します。絵文字などは書記素単位で削除します。
- 別々の contenteditable 欄をまたぐため、Text から Common の分配計算へ行頭 Backspace を明示して渡します。UI の一括更新、カーソル移動、Undo/Redo に乗せて処理します。releaseを作る前にローカルビルドをsubkarteへ反映して実Formで検証します。
- Mac Safari と iPad Safari（iOS 18.3.1、日本語かなソフトウェアキーボード）では、2行目の先頭で Backspace／「削除」を押しても `beforeinput` と `input` が発火せず、`keydown` の `key: "Backspace"` だけが発火することを実測しました。行頭の `keydown` でも既定動作を止め、同じ段間削除処理を呼びます。`beforeinput` が届くブラウザでも二重削除を防ぎます。IME変換中、選択範囲がある場合、行の途中では通常の入力処理に任せます。

### 開発中の追加修正: 行末の Enter で空段を挿入

- 本文欄の末尾で Enter を押すと、次の段を空欄として確保し、そこへカーソルを移します。後続の既存本文は自動折返しの続きも含めて一段下へ送り、最終段からあふれた本文は従来の `onBeforeDiscard` による操作前保存が成功した場合に破棄します。
- 自動折返しの続きが次段に保存されていても、その文字を新しい空段へ流し込まず、空段の下へ移します。Enter でできた境界は明示改行として扱い、その後の通常編集で上下の本文を自動連結しません。
- Common の分配計算と Text の実際の `insertParagraph` 入力、subkarte の実Formで空段・押し出し・カーソル・Undoを検証します。開発中はローカルビルドをsubkarteへ反映し、releaseは最終確認後に作ります。

### v5lock.11の修正

- 上限いっぱいの本文欄へキーボード・日本語変換・貼り付けで追記すると、元の欄の確定値が変わらず、編集DOMだけにあふれた文字が残る問題を修正しました。入力元の同期キャッシュを無効化し、元の欄と次の段の表示を確定値に揃えます。
- 変換中は入力DOMを保持し、確定後に分配します。保存済みの長文・改行入り欄を保持する互換仕様は維持します。

### v5lock.10の再レビュー修正

- 表の伸縮による改ページ後は、元テンプレートのページ番号ではなく、実際に表示されているページごとに本文欄を判定します。別の表示ページへの分配と容量判定の漏れを修正しました。
- `Form.setInputs()` は、表の配列値を既存のJSON文字列形式へ揃えてから、表示と本文分配の内部状態へ同じ値を渡します。後の本文編集で表が壊れる問題を修正しました。
- 押し出し前保存を呼び出す前に待機状態を確立します。保存hookから同期的に別欄が変更されても、未保存の本文を確定せず、保存失敗時には本文を戻します。
- subkarte側は入力確定待ち後から保存snapshot取得までの追加入力も検査します。ノート追加の描画待ち中に追記すると旧本文を保存して新ノートへ移動していた問題を修正しました。

### 主な独自実装の場所とupstream取り込み時の注意

- Common: `packages/common/src/textFlow.ts`（名前判定、幅計算、互換読み込み、純粋な分配計算、追加API型）
- Text: `packages/schemas/src/text/textFlowEditor.ts`、`text/uiRender.ts`（contenteditableのinput/paste/IME/選択範囲と入力DOM保持）
- UI: `packages/ui/src/textFlow.ts`、`Form.tsx`、`class.ts`、`components/Preview.tsx`、`components/Renderer.tsx`（一括更新、保存待ち・取消、カーソル、Undo/Redo）
- Generator: `packages/generator/src/generate.ts`（旧キー補完を必須項目検査・PDF描画前に適用）

upstream更新時はこれらを独自機能として維持し、[TEXT_FLOW.md](TEXT_FLOW.md) の仕様とcommon/schemas/ui/generatorのtextFlow回帰テストを確認してください。subkarte側の有効化、通知、履歴付き保存との連携も必要です。iPad Safariの日本語変換・音声入力の継続・キーボード保持は実機検証が必要です。

v5lockのtarballはnpmに公開せず、7パッケージを同じ版でビルドし、GitHub Releaseのアセットとして提供します。公開時は検証済みtarballとチェックサムをReleaseに添付し、アプリはそのアセットURLを参照します。

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
