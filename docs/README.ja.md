<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### あなたのAIワークステーション — チームと個人のために

ローカルにデプロイ。24時間自動化。AIデジタルヒューマンがあなたの代わりに働き、あなたは意思決定に集中。

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#インストール)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**ダウンロード**](#インストール) · [**ドキュメント**](#ドキュメント) · [**コントリビュート**](#コントリビュート)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **[Deutsch](./README.de.md)** | **[Français](./README.fr.md)** | **日本語**

</div>

<!-- TODO: Replace with a 30-second GIF showing: user types a sentence -> Agent automatically writes code -> files appear in Artifact Rail -> preview the result -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## なぜHaloなのか？

Haloは最先端のAgentを搭載したAIワークステーションで、プラグイン可能なエンジンアーキテクチャを採用しています — [Claude Code](https://github.com/anthropics/claude-code)、[Codex](https://github.com/openai/codex)などに対応。30万行以上のコードからなる完全なプロダクト層を持ち、数万人のユーザーに検証され、エンタープライズ環境で安定稼働しているHaloが提供するもの：

| Haloが提供するもの |
|:---:|
| **あなたの日常AIパートナー** — コーディング、プロダクトデザイン、運用、ライティング、リサーチ — 毎日の仕事のパートナー |
| **100%ローカル、クラウド依存ゼロ** — データはマシンから出ることなく、エンタープライズコンプライアンス要件を満たします |
| **AIデジタルヒューマン** — 7x24で自律的に稼働するAIワーカー、モニタリング、レポート、定型業務を処理 |
| **AI Browser** — AIが直接制御する組み込みブラウザ、あらゆるWebベースシステムを自動化 |
| **WeCom / WeChatネイティブコントロール** — エンタープライズIMからAIエージェントを管理、トレーニングコストゼロ |
| **リモートアクセス** — スマートフォン / H5 / WeChat / Androidから制御、マネージャーは外出先で進捗確認 |
| **ダウンロードしてすぐ使える** — 設定不要、バックエンド不要、ITは数分でデプロイ |

> Claude CodeのAgent機能、MCP、Skillsと100%互換。

---

## AIデジタルヒューマン — あなたの自律型AIワークフォース

従来のRPAは固定スクリプトに従い、何かが変わると壊れます。Haloは異なるアプローチを取ります：**AIが判断し、Halo Browser Skillsが操作を実行。**その結果、コンテキストを理解し、変化に適応し、精密に実行する自動化が実現します。

### 7x24稼働する自律エージェント

AIデジタルヒューマンを作成し、タスクと実行頻度を設定すれば、スケジュールに従って自律的に稼働します。画面を監視する必要も、スクリプトを管理する必要もありません。

**ソーシャル＆コンテンツプラットフォーム自動化：**

- Xiaohongshu、Bilibili、Zhihuのコメントやダイレクトメッセージへの自動返信
- Twitter / X、WeChat公式アカウントへのスケジュール投稿
- ブランド言及と競合活動の監視、デイリーダイジェストの生成
- トレンドトピックの追跡とコンテンツ提案の自動作成

**エンタープライズ内部自動化：**

- 内部OA / CRM / ERPシステムのパトロール、期限切れチケットや異常のフラグ付け
- Jira / GitLab / GitHubの活動からデイリースタンドアップレポートを生成
- CI/CDパイプラインの監視、ビルド失敗の通知、インシデントチケットの自動作成
- 内部ダッシュボードでのスケジュール化されたコンプライアンスチェックの実行
- 部門横断データの収集と週次エグゼクティブサマリーの作成

**AIデジタルヒューマンストア**からワンクリックでインストール、組織向けの**プライベートストア**をデプロイ、または自然言語で独自のものを作成できます。

> cron + RPA + AI Agentを一つにしたものと考えてください — ただし、やりたいことを自然言語で説明するだけです。

AIデジタルヒューマンは会話モードとまったく同じAgent機能を持っています — 同じClaudeエンジン、MCPツールチェーン、AI Browser — スケジュールに従って自動的にトリガーされるだけで、コンピューターの前にいる必要はありません。

**WeChat / WeComがあなたのコントロールパネルです。**AIデジタルヒューマンは個人WeChat / WeCom（企業WeChat）を通じた双方向の会話制御をサポートしています — 通知を受け取るだけでなく、指示を出し、進捗を確認し、レポートを直接エンタープライズIMで要求できます。

![AI Digital Human](./assets/ai-digital-human.png)

### Halo Browser Skill — AIが判断し、スクリプトが実行

これが、やみくもにクリックする「AIブラウザエージェント」とHaloを差別化するポイントです。

Halo Browser SkillはRPAのアプローチで信頼性を確保します：**各プラットフォームの一般的な操作用に再利用可能なスクリプトを事前に作成**。AIは*何を*するか、*いつ*するかだけを判断し — スクリプトはすでに*どのように*するかを知っています。

スクリプトはHaloの`browser_run`を通じて実際のブラウザで直接実行されます — ページのDOM、Cookie、内部APIへのフルアクセスがあり、Chrome DevToolsコンソールと同じです。パブリックプラットフォームでもプライベートなエンタープライズシステムでも動作します。

**例：Bilibiliの通知を読む**

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'  // cookies automatically included, no extra auth
  }).then(r => r.json())

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

AIはこのように呼び出します：`browser_run({ file: ".claude/skills/bili-get-messages/index.js" })`

**例：エンタープライズワークフロー — Xiaohongshuコンテンツ運用デジタルヒューマン：**
1. AIが判断：今日の投稿の新しいコメントを確認する時間
2. `xhs-get-comments` Skillを呼び出し → スクリプトがプラットフォームAPIでコメントリストを取得
3. AIが評価：この5つのコメントに返信が必要、パーソナライズされた返信を作成
4. `xhs-reply-comment` Skillを呼び出し → スクリプトが各返信を送信

**例：エンタープライズ内部 — DevOps監視デジタルヒューマン：**
1. AIが判断：1時間ごとのインフラチェックの時間
2. `check-grafana-alerts` Skillを呼び出し → スクリプトが内部APIでアラートダッシュボードを読み取り
3. AIが評価：2つのアラートが重大、インシデントサマリーを作成
4. `create-jira-ticket` Skillを呼び出し → スクリプトが完全なコンテキスト付きP1チケットを作成
5. `notify-oncall` Skillを呼び出し → WeCom当番グループにアラートをプッシュ

**AIが判断。Skillsが実行。安定、再現可能、監査可能。**

Xiaohongshu、Bilibili、Zhihu、Twitter / X、WeChat用のすぐに使えるSkillsが利用可能です。エンタープライズチームは内部システム用のプライベートSkillsを作成できます。コミュニティは独自のものを貢献・共有できます。

### リモートアクセス — どこからでもAIフリートを管理

リモートアクセスを有効にすると、スマートフォン / H5 / WeChat / Androidクライアントからデスクトップ上のHaloを制御できます。会議中、通勤中、外出先で — デジタルヒューマンの出力を確認し、判断を承認し、デスクにいなくても新しい指示を出せます。

---

## クイックスタート

**30秒で始められます：**

1. [ダウンロードしてインストール](#インストール)、Haloを起動
2. API Keyを入力（Anthropic推奨）
3. チャットを開始 — `Build a todo app with React`や`Help me analyze the code structure of this project`を試してみてください
4. Artifact Railにファイルが表示されるのを確認、クリックでプレビュー、変更をリクエスト

> 推奨モデル：Claude Sonnet / Opusシリーズ

---

## インストール

### ダウンロード（推奨）

| プラットフォーム | ダウンロード | 要件 |
|----------|----------|--------------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | ソースからビルド | iOS 15+ |

**ダウンロード、インストール、実行。**Node.js、npm、ターミナルは不要です。ITはサーバー側の依存関係なしに組織全体に配布できます。

### ソースからビルド

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## AIデジタルヒューマンストア

<table>
<tr>
<td width="50%" valign="top">

### ユーザー向け — すぐにインストールして使用

AIデジタルヒューマンストアを開き、一つ選び、いくつかの設定項目を入力すれば、自動的に稼働を開始します。コーディング不要、プロンプトを書く必要もありません。

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### 開発者向け — 作成して公開

`spec.yaml`を書いて[AI Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol)にPRを提出してください。マージされると、すべてのHaloユーザーにすぐに利用可能になります。

Halo Browser Skills（`.js`スクリプト）を作成して、AIデジタルヒューマンが特定のプラットフォームで正確に操作を実行できるようにすることもできます。

</td>
</tr>
</table>

---

## スクリーンショット

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*リモートアクセス：どこからでもHaloを制御*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="モバイルリモートアクセス">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="モバイルチャット">
</p>

*AI Browser*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## アーキテクチャ

```
┌──────────────────────────────────────────────────┐
│                   Halo Desktop                    │
│                                                   │
│   React UI  <─IPC─>  Main Process  <──>  Claude  │
│  (Renderer)          ┌───────────┐       Code SDK │
│                      │ Digital   │      (Agent    │
│                      │ Humans    │       Loop)    │
│                      │ Scheduler │                │
│                      └───────────┘                │
│                           │                       │
│                     ~/.halo/ (local)              │
└──────────────────────────────────────────────────┘
```

---

## その他の機能

- **100%ローカル** — データはマシンから出ることなく、エンタープライズコンプライアンス要件を満たします
- **バックエンド不要** — 純粋なデスクトップクライアント、サーバーインフラなしで各ワークステーションにデプロイ
- **Agent Loop** — テキスト生成だけでなく、ツール実行
- **Spaceシステム** — 隔離されたワークスペース、プロジェクト同士が干渉しない
- **Skills** — SkillパックをインストールしてAgent機能を拡張
- **AI Browser** — 組み込みCDPブラウザ、AIがWebページを直接制御
- **マルチモデル対応** — Anthropic、OpenAI、DeepSeek、およびすべてのOpenAI互換API（エンタープライズLLMゲートウェイに接続）
- **ダーク/ライトテーマ** — システム設定に追従
- **多言語対応** — 中国語、英語、スペイン語など

[**すべての機能を探索 →**](https://hello-halo.cc/docs/features/spaces.html)

---

## ロードマップ

- [x] Claude Code SDK Agent Loop
- [x] Spaceと会話の管理
- [x] Artifactプレビュー（コード、HTML、画像、Markdown）
- [x] リモートアクセス
- [x] AI Browser (CDP)
- [x] MCP Serverサポート
- [x] Skillsシステム
- [x] AIデジタルヒューマンとAIデジタルヒューマンストア
- [ ] サードパーティエコシステムプラグイン互換性
- [ ] コード編集体験の強化
- [ ] ビジュアルGit + AI支援コードレビュー
- [ ] AI搭載ファイル検索
- [ ] 低コストデジタルヒューマンレコーディング — AIワークフローを自動記録し、再利用可能なデジタルヒューマンとしてリプレイ

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
- **コード貢献** — PRを歓迎します

詳細は[CONTRIBUTING.md](../CONTRIBUTING.md)をご覧ください。

---

## コミュニティ

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="個人WeChat QRコード">
</p>
<p align="center">
  <em>フィードバックや議論については、WeChat: go2haloを「Halo」というメモ付きで追加してください</em>
</p>

---

## Haloの物語

2025年10月、シンプルな不満から始まりました：**Claude Codeを使いたかったけど、一日中会議に追われていた。**

退屈な会議中に思いました：*自宅のパソコンのClaude Codeをスマートフォンから制御できたらどうだろう？*

次に2つ目の問題が来ました — 非技術系の同僚も使いたがっていましたが、インストールで行き詰まりました。*「npmって何？」*

そこでHaloを作りました：ビジュアルインターフェース、ワンクリックインストール、リモートアクセス。最初のバージョンは数時間で完成。その後のすべては？**100% Halo自身が構築しました。**

今、私たちは次のステップが**AIワークステーション**だと信じています：AIはもう誰かが見ていなくても仕事ができます。あなたが目標を設定し、AIデジタルヒューマンが7x24で自律的に前進します。コードを書き、テストを実行し、デプロイを監視し、レポートを生成 — 継続的に稼働し、あなたは重要なチェックポイントでのみ意思決定を行います。

それがHaloが構築しているものです。

---

## ライセンス

MIT — [LICENSE](../LICENSE)

---

<div align="center">

## コントリビューター

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**このリポジトリにスターを付けて**、より多くの人がHaloを発見できるようにしてください。

</div>

---

## パートナー & スポンサー

Halo があなたのプロジェクトにインスピレーションを与えた場合、または Halo をベースに何かを構築した場合は、ぜひご紹介ください。

### エンタープライズパートナー

<!-- Add your company logo here — submit a PR or contact us at the link below -->

| あなたの会社でHaloを使っていますか？ | [お知らせください](https://github.com/openkursar/hello-halo/issues/new?title=Add+our+company+as+partner) — ここでご紹介させていただきます。 |
|:---:|:---:|

### スポンサー

<a href="https://www.nnscholar.com/">
  <img src="https://www.nnscholar.com/favicon.ico" height="40" alt="NNScholar">
</a>

<p align="center">
  <a href="https://buy.polar.sh/polar_cl_x7bTGvMvt3rbUt6oE98z0zb2zFz1sT7dG37BA3foNsZ">Polar (International)</a> · <a href="https://ifdian.net/a/hello-halo">爱发电 (Alipay / WeChat)</a>
</p>

---

<div align="center">

[トップに戻る](#halo)

</div>
