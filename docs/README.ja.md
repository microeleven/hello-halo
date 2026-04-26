<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Desktop AI Agent. Code, automate, run 7x24.

Claude Code のすべての能力を、ターミナル不要で。
コードを書き、ブラウザを操作し、デジタルヒューマンを作成 —— あなたの AI は、24時間体制で待機しています。

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#インストール)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**ダウンロード**](#インストール) · [**ドキュメント**](#ドキュメント) · [**コントリビュート**](#コントリビュート)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **[Deutsch](./README.de.md)** | **[Français](./README.fr.md)**

</div>

<!-- TODO: 30秒 GIF に差し替え予定：ユーザーが一言入力 → Agent が自動でコードを書く → ファイルが Artifact Rail に出現 → プレビュー表示 -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## なぜ Halo を選ぶのか？

Halo は [Claude Code](https://github.com/anthropics/claude-code) の上に構築され、完全なプロダクト機能を備えています。累計30万行以上のコード、数万人のユーザーによる検証を経て、エンタープライズ環境で安定稼働しています。さらに、Halo は以下を実現しています：

| ターミナルではできないこと | Halo ならできる |
|:---:|:---:|
| AI が生成した各ファイルを確認する | **Artifact Rail** でコード、HTML、画像をリアルタイムプレビュー |
| パソコンを離れると停止する | **リモートアクセス**、スマホ / H5 / WeChat / Android クライアントからいつでも続行 |
| 毎回手動で起動する必要がある | **デジタルヒューマン** が 7x24 自動で稼働 |
| 非技術者の同僚に使ってもらう | **ダウンロードしてすぐ使える**、設定不要 |
| ブラウザ操作を自動化する | **AI Browser** 内蔵ブラウザを AI が直接制御 |

> Powered by [Claude Code](https://github.com/anthropics/claude-code) — Claude Code の Agent 機能、MCP、Skills と 100% 互換。

---

## あなたの AI は、あなたが見ていなくても動く

ほとんどの AI ツールは、画面の前に座って一回一回対話する必要があります。Halo は違います —— 自分で作業を進め、あなたは重要な判断ポイントでだけ意思決定すればよいのです。

### デジタルヒューマン —— 7x24 自律稼働する AI ワーカー

デジタルヒューマンを作成し、タスクと実行頻度を設定すれば、計画通りに自律的に稼働します：

- 毎朝テックニュースの要約をプッシュ配信
- 1時間ごとにオンラインサービスの状態をチェックし、異常時に通知
- 定期的に競合分析を実行し、比較レポートを生成
- GitHub の依存関係の更新とセキュリティ脆弱性を監視
- SNS でのキーワードの言及量をトラッキング

**デジタルヒューマンストア** からワンクリックでインストール、または自然言語で独自のものを作成できます。

> cron job + AI Agent の組み合わせだと思ってください —— ただし、普通の言葉で指示するだけです。

デジタルヒューマンは、対話モードとまったく同じ Agent 機能を備えています —— 同じ Claude エンジン、MCP ツールチェーン、AI Browser。ただし、スケジュールに従って自動的にトリガーされるので、パソコンの前に座っている必要はありません。

**WeChat があなたのコントロールパネルに。** デジタルヒューマンは個人 WeChat / WeCom を通じた双方向の対話制御に対応 —— 通知を受け取るだけでなく、WeChat から直接デジタルヒューマンに指示を出したり、進捗を確認したり、レポートを要求したりできます。

![AI Digital Human](./assets/ai-digital-human.png)

### Browser Skill —— AI によるウェブサイト操作を安定・確実に

通常の AI ブラウザ自動化では、毎回 AI 自身がクリック方法や入力方法を探り当てるため、頻繁に失敗します。

Browser Skill は異なるアプローチを取ります：**各ウェブサイトでの一般的な操作を、あらかじめ再利用可能なスクリプトとして作成しておく**。AI は「今どのスクリプトを呼び出すべきか」を判断するだけで、ウェブサイトの具体的な操作はスクリプトが処理済みです。

Skill スクリプトは Halo の `browser_run` を通じて実際のブラウザ環境で直接実行されます —— ページの DOM、Cookie、内部 API にアクセスでき、Chrome DevTools コンソールで操作するのと同じです。例えば、以下は Bilibili 通知読み取り Skill のコアコードです：

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  // B站の内部 API を直接呼び出し —— Cookie は自動的に付与され、追加の認証は不要
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'
  }).then(r => r.json())

  // 構造化データを AI に返し、AI が返信方法を判断
  return {
    success: true,
    notifications: resp.data.items.map(item => ({
      user: item.user.nickname,
      comment: item.item.source_content,
      video_title: item.item.title
    }))
  }
}
```

デジタルヒューマンが呼び出す際は一行だけ：`browser_run({ file: "skills/bili-get-messages/index.js" })` —— データを取得後、AI がどれに返信すべきか、どう返信するかを自ら判断します。

例えば、知乎デジタルヒューマンのワークフロー：
1. AI が判断：新しい回答の招待があるか確認しよう
2. `zhihu-creator-invited` Skill を呼び出し → スクリプトが自動的に招待リストを取得し、構造化データを返す
3. AI が判断：この質問は回答する価値がある、執筆開始
4. `zhihu-publish-answer` Skill を呼び出し → スクリプトが自動的にエディタに入力して公開

AI が判断し、Skill が操作する。安定的、再現可能、失敗しない。

現在、Bilibili、知乎、WeChat、小紅書などのプラットフォーム向けの既製 Skill があり、コミュニティも独自の Skill をコントリビュートできます。

### リモートアクセス —— スマホがあなたの AI リモコンに

リモートアクセスを有効にすると、スマホ / H5 / WeChat / Android クライアントからデスクトップの Halo を制御できます。会議中、通勤中、さらには病院のベッドの上からでも（実話）、いつでも AI の作業進捗を確認し、新しい指示を出せます。

---

## クイックスタート

**30秒で使い始められます：**

1. [ダウンロードしてインストール](#インストール)、Halo を起動
2. API Key を入力（Anthropic 推奨）
3. 対話を開始 —— `React で ToDo アプリを作って` や `このプロジェクトのコード構造を分析して` を試してみてください
4. ファイルが Artifact Rail に表示されるのを確認し、クリックしてプレビュー、修正を依頼

> 推奨モデル：Claude Sonnet / Opus シリーズ

---

## インストール

### ダウンロード（推奨）

| プラットフォーム | ダウンロード | 要件 |
|------|------|------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | ソースからビルド | iOS 15+ |

**ダウンロード、インストール、実行。** Node.js 不要、npm 不要、ターミナル不要。

### ソースからビルド

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## デジタルヒューマンストア

<table>
<tr>
<td width="50%" valign="top">

### ユーザー向け —— すぐにインストールして使える

デジタルヒューマンストアを開き、一つ選んで、いくつかの設定項目を入力すれば、自動で稼働を開始します。コード不要、プロンプト不要。

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### 開発者向け —— ビルドして公開

`spec.yaml` を作成し、[Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol) に PR を提出してください。マージ後、すべての Halo ユーザーがすぐに利用可能になります。

デジタルヒューマン向けの Browser Skill（`.js` スクリプト）を作成し、特定のプラットフォーム上で正確な操作を実行させることもできます。

</td>
</tr>
</table>

---

## スクリーンショット

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*リモートアクセス：どこからでも Halo を制御*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="モバイルリモートアクセス">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="モバイルチャット">
</p>

*AI ブラウザ*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## アーキテクチャ

```
┌──────────────────────────────────────────────────┐
│                   Halo Desktop                    │
│                                                   │
│   React UI  ◄─IPC─►  Main Process  ◄──►  Claude  │
│  (Renderer)          ┌───────────┐       Code SDK │
│                      │ Digital   │      (Agent    │
│                      │ Humans    │       Loop)    │
│                      │ Scheduler │                │
│                      └───────────┘                │
│                           │                       │
│                     ~/.halo/ (ローカル)             │
└──────────────────────────────────────────────────┘
```

- **100% ローカル** — データはあなたのパソコンから離れません（API 呼び出しを除く）
- **バックエンド不要** — 純粋なデスクトップクライアント、自分の API Key を使用
- **Agent Loop** — テキスト生成だけでなく、ツール実行

---

## その他の機能

- **Space ワークスペースシステム** — 隔離されたワークスペースで、プロジェクトが互いに干渉しない
- **Skills スキル** — スキルパックをインストールして Agent の能力を拡張
- **AI Browser** — 内蔵 CDP ブラウザ、AI がウェブページを直接操作
- **マルチモデル対応** — Anthropic、OpenAI、DeepSeek、および任意の OpenAI 互換 API
- **ダーク/ライトテーマ** — システムに連動
- **多言語対応** — 中国語、英語、スペイン語など

---

## ロードマップ

- [x] Claude Code SDK Agent Loop
- [x] Space と会話管理
- [x] Artifact プレビュー（コード、HTML、画像、Markdown）
- [x] リモートアクセス
- [x] AI Browser (CDP)
- [x] MCP Server サポート
- [x] Skills スキルシステム
- [x] デジタルヒューマンとデジタルヒューマンストア
- [ ] サードパーティエコシステムプラグイン互換
- [ ] コード編集体験の強化
- [ ] Git 可視化 + AI アシスト Code Review
- [ ] AI スマートファイル検索

---

## コントリビュート

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **翻訳** — `src/renderer/i18n/`
- **バグ報告** — [Issues](https://github.com/openkursar/hello-halo/issues)
- **機能提案** — [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **コード貢献** — PR welcome

詳しくは [CONTRIBUTING.md](../CONTRIBUTING.md) をご覧ください

---

## コミュニティ

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/49f1040c-b858-4d43-841b-206310d3c33f" width="200" alt="WeChat グループ QR コード">
</p>
<p align="center">
  <em>QR コードの有効期限が切れている場合は、WeChat：go2halo を追加し「Halo」と備考してください</em>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="個人 WeChat QR コード">
</p>

---

## Halo のストーリー

2025年10月、一つのシンプルな悩みから始まりました：**Claude Code を使いたいのに、一日中会議漬けだった。**

退屈な会議の中で思いました：*スマホから自宅のパソコンの Claude Code を操作できたらどうだろう？*

そして二つ目の問題 —— 非技術者の同僚も使いたがっていたが、インストールの段階でつまずいた。*「npm って何？」*

だから Halo を作りました：ビジュアルインターフェース、ワンクリックインストール、リモートアクセス。最初のバージョンは数時間で完成。その後のすべての機能は、**100% Halo 自身が構築しました。**

今、私たちは次のステップは **AI ワークステーション** だと確信しています：AI はもう人が見ていなくても働ける。目標を設定すれば、デジタルヒューマンが 7x24 自律的に推進する。コードを書き、テストを実行し、デプロイを監視し、レポートを生成 —— 継続的に稼働し、あなたは重要な判断ポイントでだけ意思決定する。

これが Halo の取り組んでいることです。

---

## ライセンス

MIT — [LICENSE](../LICENSE)

---

<div align="center">

## コントリビューター

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**このリポジトリに Star を** して、より多くの人に Halo を届けましょう。

[![Star History Chart](https://api.star-history.com/svg?repos=openkursar/hello-halo&type=Date)](https://star-history.com/#openkursar/hello-halo&Date)

[⬆ トップに戻る](#halo)

</div>
