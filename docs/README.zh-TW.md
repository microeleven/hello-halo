<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Desktop AI Agent. Code, automate, run 7x24.

Claude Code 的全部能力，不需要終端。
寫程式碼、操控瀏覽器、建立數位人 —— 你的 AI，全天候待命。

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#安裝)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**下載安裝**](#安裝) · [**文件**](#文件) · [**參與貢獻**](#參與貢獻)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[Español](./README.es.md)** | **[Deutsch](./README.de.md)** | **[Français](./README.fr.md)** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: 替換成一個 30 秒 GIF，展示：使用者輸入一句話 → Agent 自動寫程式碼 → 檔案出現在 Artifact Rail → 預覽效果 -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## 為什麼選擇 Halo？

Halo 建構在 [Claude Code](https://github.com/anthropics/claude-code) 之上，建構了完整的產品能力，累計超過 30 萬行程式碼，數萬使用者的驗證，並穩定運行在企業環境。在此之上，Halo 還做到了：

| 終端裡做不到的 | Halo 可以 |
|:---:|:---:|
| 看到 AI 生成的每個檔案 | **Artifact Rail** 即時預覽程式碼、HTML、圖片 |
| 離開電腦就停了 | **遠端存取**，手機 / H5 / 微信 / 安卓客戶端隨時繼續 |
| 每次都要手動啟動 | **數位人** 7x24 自動運行 |
| 給非技術同事用 | **下載即用**，零設定 |
| 自動化瀏覽器操作 | **AI Browser** 內嵌瀏覽器，AI 直接控制 |

> Powered by [Claude Code](https://github.com/anthropics/claude-code) — 100% 相容 Claude Code 的 Agent 能力、MCP、Skills。

---

## 你的 AI，不需要你盯著

大多數 AI 工具需要你坐在螢幕前、一輪一輪地對話。Halo 不一樣 —— 它可以自己幹活，你只需要在關鍵節點做決策。

### 數位人 —— 7x24 自主運行的 AI 員工

建立一個數位人，給它一個任務和執行頻率，它就會按計畫自主運行：

- 每天早上推送科技新聞摘要
- 每小時檢查線上服務狀態，異常時通知你
- 定時跑競品分析，生成對比報告
- 監控 GitHub 依賴更新和安全漏洞
- 追蹤關鍵字在社群媒體的提及量

在 **數位人商店** 一鍵安裝，或用自然語言建立你自己的。

> 把它想像成 cron job + AI Agent 的結合體 —— 但你只需要說人話。

數位人擁有和對話模式完全一致的 Agent 能力 —— 同一套 Claude 引擎、MCP 工具鏈、AI Browser，只不過它按計畫自動觸發，不需要你坐在電腦前。

**微信就是你的控制台。** 數位人支援透過個人微信 / 企業微信雙向對話控制 —— 不只是接收通知，你可以直接在微信裡給數位人下指令、查進度、要報告。

![AI Digital Human](./assets/ai-digital-human.png)

### Browser Skill —— 讓 AI 操作網站，變得穩定可靠

普通的 AI 瀏覽器自動化，每次都讓 AI 自己摸索怎麼點、怎麼填，經常翻車。

Browser Skill 換了一種思路：**把對每個網站的常用操作，提前寫成可複用的腳本**。AI 只需要決定「現在該調哪個腳本」，具體怎麼操作網站，腳本已經處理好了。

Skill 腳本透過 Halo 的 `browser_run` 直接運行在真實瀏覽器環境中 —— 能存取頁面 DOM、Cookie、內部 API，就像你在 Chrome DevTools 控制台裡操作一樣。舉個例子，下面是一個 Bilibili 通知讀取 Skill 的核心程式碼：

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  // 直接呼叫 B站內部 API —— Cookie 自動攜帶，無需額外認證
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'
  }).then(r => r.json())

  // 回傳結構化資料給 AI，AI 來決定如何回覆
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

數位人呼叫時只需一句：`browser_run({ file: "skills/bili-get-messages/index.js" })` —— 拿到資料後，AI 自行判斷哪些需要回覆、怎麼回覆。

比如一個知乎數位人的工作流程：
1. AI 決定：該去看看有沒有新的邀請回答了
2. 呼叫 `zhihu-creator-invited` Skill → 腳本自動取得邀請列表，回傳結構化資料
3. AI 判斷：這個問題值得回答，開始寫
4. 呼叫 `zhihu-publish-answer` Skill → 腳本自動填寫編輯器並發布

AI 做判斷，Skill 做操作。穩定、可重複、不翻車。

目前已有 Bilibili、知乎、微信、小紅書等平台的現成 Skill，社群也可以貢獻自己的。

### 遠端存取 —— 手機就是你的 AI 遙控器

開啟遠端存取後，手機 / H5 / 微信 / 安卓客戶端都能控制桌面上的 Halo。開會時、通勤時、甚至在醫院病床上（真實故事），隨時查看 AI 的工作進度，下達新指令。

---

## 快速開始

**30 秒開始使用：**

1. [下載安裝](#安裝)，啟動 Halo
2. 輸入 API Key（推薦 Anthropic）
3. 開始對話 —— 試試 `用 React 寫一個待辦應用` 或 `幫我分析這個專案的程式碼結構`
4. 看著檔案在 Artifact Rail 中出現，點擊預覽，要求修改

> 推薦模型：Claude Sonnet / Opus 系列

---

## 安裝

### 下載（推薦）

| 平台 | 下載 | 要求 |
|------|------|------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | 從原始碼建置 | iOS 15+ |

**下載、安裝、運行。** 不需要 Node.js，不需要 npm，不需要終端。

### 從原始碼建置

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## 數位人商店

<table>
<tr>
<td width="50%" valign="top">

### 對使用者 —— 秒裝即用

打開數位人商店，選一個，填幾個設定項，它就開始自動運行了。不需要寫程式碼，不需要寫 Prompt。

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### 對開發者 —— 建構並發布

寫一個 `spec.yaml`，向 [Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol) 提交 PR。合併後所有 Halo 使用者立刻可用。

你也可以為數位人編寫 Browser Skill（`.js` 腳本），讓它在特定平台上精確執行操作。

</td>
</tr>
</table>

---

## 截圖

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*遠端存取：從任何地方控制 Halo*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="行動端遠端存取">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="行動端聊天">
</p>

*AI 瀏覽器*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## 架構

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
│                     ~/.halo/ (本機)                │
└──────────────────────────────────────────────────┘
```

- **100% 本機** — 資料不離開你的電腦（除 API 呼叫）
- **無需後端** — 純桌面客戶端，用你自己的 API Key
- **Agent Loop** — 工具執行，不只是文字生成

---

## 更多能力

- **Space 空間系統** — 隔離的工作空間，專案互不干擾
- **Skills 技能** — 安裝技能包擴展 Agent 能力
- **AI Browser** — 內嵌 CDP 瀏覽器，AI 直接操控網頁
- **多模型支援** — Anthropic、OpenAI、DeepSeek，及任何 OpenAI 相容 API
- **深色/淺色主題** — 跟隨系統
- **多語言** — 中文、英文、西班牙語等

---

## 路線圖

- [x] Claude Code SDK Agent Loop
- [x] Space 與對話管理
- [x] Artifact 預覽（程式碼、HTML、圖片、Markdown）
- [x] 遠端存取
- [x] AI Browser (CDP)
- [x] MCP Server 支援
- [x] Skills 技能系統
- [x] 數位人與數位人商店
- [ ] 第三方生態外掛相容
- [ ] 增強程式碼編輯體驗
- [ ] Git 視覺化 + AI 輔助 Code Review
- [ ] AI 智慧檔案搜尋

---

## 參與貢獻

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **翻譯** — `src/renderer/i18n/`
- **Bug 報告** — [Issues](https://github.com/openkursar/hello-halo/issues)
- **功能建議** — [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **程式碼貢獻** — PR welcome

詳見 [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 社群

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/49f1040c-b858-4d43-841b-206310d3c33f" width="200" alt="微信群二維碼">
</p>
<p align="center">
  <em>如二維碼過期，加微信：go2halo 備註 "Halo"</em>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="個人微信二維碼">
</p>

---

## Halo 的故事

2025 年 10 月，一個簡單的困擾：**我想用 Claude Code，但整天都在開會。**

在無聊的會議中，我想：*如果能從手機控制家裡電腦上的 Claude Code 呢？*

然後是第二個問題 —— 非技術同事也想用，但卡在了安裝環節。*「什麼是 npm？」*

所以我做了 Halo：視覺化介面、一鍵安裝、遠端存取。第一版用了幾個小時。之後的所有功能，**100% 由 Halo 自己建構。**

現在，我們相信下一步是 **AI 工作站**：AI 不再需要人盯著才能幹活。你設定目標，數位人 7x24 自主推進。寫程式碼、跑測試、監控部署、生成報告 —— 持續運轉，你只在關鍵節點決策。

這就是 Halo 正在做的事。

---

## 授權條款

MIT — [LICENSE](../LICENSE)

---

<div align="center">

## 貢獻者

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**Star 這個儲存庫**，幫助更多人發現 Halo。

[![Star History Chart](https://api.star-history.com/svg?repos=openkursar/hello-halo&type=Date)](https://star-history.com/#openkursar/hello-halo&Date)

[⬆ 返回頂部](#halo)

</div>
