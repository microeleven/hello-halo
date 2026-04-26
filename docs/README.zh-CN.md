<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Desktop AI Agent. Code, automate, run 7x24.

Claude Code 的全部能力，不需要终端。
写代码、操控浏览器、创建数字人 —— 你的 AI，全天候待命。

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#安装)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**下载安装**](#安装) · [**文档**](#文档) · [**参与贡献**](#参与贡献)

**[English](../README.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **[Deutsch](./README.de.md)** | **[Français](./README.fr.md)** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: 替换成一个 30 秒 GIF，展示：用户输入一句话 → Agent 自动写代码 → 文件出现在 Artifact Rail → 预览效果 -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## 为什么选择 Halo？

Halo 构建在 [Claude Code](https://github.com/anthropics/claude-code) 之上，构建了完整的产品能力，累计超过 30 万行代码，数万用户的验证，并稳定运行在企业环境。在此之上，Halo 还做到了：

| 终端里做不到的 | Halo 可以 |
|:---:|:---:|
| 看到 AI 生成的每个文件 | **Artifact Rail** 实时预览代码、HTML、图片 |
| 离开电脑就停了 | **远程访问**，手机 / H5 / 微信 / 安卓客户端随时继续 |
| 每次都要手动启动 | **数字人** 7x24 自动运行 |
| 给非技术同事用 | **下载即用**，零配置 |
| 自动化浏览器操作 | **AI Browser** 内嵌浏览器，AI 直接控制 |

> Powered by [Claude Code](https://github.com/anthropics/claude-code) — 100% 兼容 Claude Code 的 Agent 能力、MCP、Skills。

---

## 你的 AI，不需要你盯着

大多数 AI 工具需要你坐在屏幕前、一轮一轮地对话。Halo 不一样 —— 它可以自己干活，你只需要在关键节点做决策。

### 数字人 —— 7x24 自主运行的 AI 员工

创建一个数字人，给它一个任务和执行频率，它就会按计划自主运行：

- 每天早上推送科技新闻摘要
- 每小时检查线上服务状态，异常时通知你
- 定时跑竞品分析，生成对比报告
- 监控 GitHub 依赖更新和安全漏洞
- 追踪关键词在社交媒体的提及量

在 **数字人商店** 一键安装，或用自然语言创建你自己的。

> 把它想象成 cron job + AI Agent 的结合体 —— 但你只需要说人话。

数字人拥有和对话模式完全一致的 Agent 能力 —— 同一套 Claude 引擎、MCP 工具链、AI Browser，只不过它按计划自动触发，不需要你坐在电脑前。

**微信就是你的控制台。** 数字人支持通过个人微信 / 企业微信双向对话控制 —— 不只是接收通知，你可以直接在微信里给数字人下指令、查进度、要报告。

![AI Digital Human](./assets/ai-digital-human.png)

### Browser Skill —— 让 AI 操作网站，变得稳定可靠

普通的 AI 浏览器自动化，每次都让 AI 自己摸索怎么点、怎么填，经常翻车。

Browser Skill 换了一种思路：**把对每个网站的常用操作，提前写成可复用的脚本**。AI 只需要决定"现在该调哪个脚本"，具体怎么操作网站，脚本已经处理好了。

Skill 脚本通过 Halo 的 `browser_run` 直接运行在真实浏览器环境中 —— 能访问页面 DOM、Cookie、内部 API，就像你在 Chrome DevTools 控制台里操作一样。举个例子，下面是一个 Bilibili 通知读取 Skill 的核心代码：

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  // 直接调用 B站内部 API —— Cookie 自动携带，无需额外认证
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'
  }).then(r => r.json())

  // 返回结构化数据给 AI，AI 来决定如何回复
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

数字人调用时只需一句：`browser_run({ file: "skills/bili-get-messages/index.js" })` —— 拿到数据后，AI 自行判断哪些需要回复、怎么回复。

比如一个知乎数字人的工作流程：
1. AI 决定：该去看看有没有新的邀请回答了
2. 调用 `zhihu-creator-invited` Skill → 脚本自动获取邀请列表，返回结构化数据
3. AI 判断：这个问题值得回答，开始写
4. 调用 `zhihu-publish-answer` Skill → 脚本自动填写编辑器并发布

AI 做判断，Skill 做操作。稳定、可重复、不翻车。

目前已有 Bilibili、知乎、微信、小红书等平台的现成 Skill，社区也可以贡献自己的。

### 远程访问 —— 手机就是你的 AI 遥控器

开启远程访问后，手机 / H5 / 微信 / 安卓客户端都能控制桌面上的 Halo。开会时、通勤时、甚至在医院病床上（真实故事），随时查看 AI 的工作进度，下达新指令。

---

## 快速开始

**30 秒开始使用：**

1. [下载安装](#安装)，启动 Halo
2. 输入 API Key（推荐 Anthropic）
3. 开始对话 —— 试试 `用 React 写一个待办应用` 或 `帮我分析这个项目的代码结构`
4. 看着文件在 Artifact Rail 中出现，点击预览，要求修改

> 推荐模型：Claude Sonnet / Opus 系列

---

## 安装

### 下载（推荐）

| 平台 | 下载 | 要求 |
|------|------|------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | 从源码构建 | iOS 15+ |

**下载、安装、运行。** 不需要 Node.js，不需要 npm，不需要终端。

### 从源码构建

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## 数字人商店

<table>
<tr>
<td width="50%" valign="top">

### 对用户 —— 秒装即用

打开数字人商店，选一个，填几个配置项，它就开始自动运行了。不需要写代码，不需要写 Prompt。

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### 对开发者 —— 构建并发布

写一个 `spec.yaml`，向 [Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol) 提交 PR。合并后所有 Halo 用户立刻可用。

你也可以为数字人编写 Browser Skill（`.js` 脚本），让它在特定平台上精确执行操作。

</td>
</tr>
</table>

---

## 截图

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*远程访问：从任何地方控制 Halo*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="移动端远程访问">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="移动端聊天">
</p>

*AI 浏览器*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## 架构

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
│                     ~/.halo/ (本地)                │
└──────────────────────────────────────────────────┘
```

- **100% 本地** — 数据不离开你的电脑（除 API 调用）
- **无需后端** — 纯桌面客户端，用你自己的 API Key
- **Agent Loop** — 工具执行，不只是文本生成

---

## 更多能力

- **Space 空间系统** — 隔离的工作空间，项目互不干扰
- **Skills 技能** — 安装技能包扩展 Agent 能力
- **AI Browser** — 内嵌 CDP 浏览器，AI 直接操控网页
- **多模型支持** — Anthropic、OpenAI、DeepSeek，及任何 OpenAI 兼容 API
- **深色/浅色主题** — 跟随系统
- **多语言** — 中文、英文、西班牙语等

---

## 路线图

- [x] Claude Code SDK Agent Loop
- [x] Space 与对话管理
- [x] Artifact 预览（代码、HTML、图片、Markdown）
- [x] 远程访问
- [x] AI Browser (CDP)
- [x] MCP Server 支持
- [x] Skills 技能系统
- [x] 数字人与数字人商店
- [ ] 第三方生态插件兼容
- [ ] 增强代码编辑体验
- [ ] Git 可视化 + AI 辅助 Code Review
- [ ] AI 智能文件搜索

---

## 参与贡献

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **翻译** — `src/renderer/i18n/`
- **Bug 报告** — [Issues](https://github.com/openkursar/hello-halo/issues)
- **功能建议** — [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **代码贡献** — PR welcome

详见 [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 社区

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/49f1040c-b858-4d43-841b-206310d3c33f" width="200" alt="微信群二维码">
</p>
<p align="center">
  <em>如二维码过期，加微信：go2halo 备注 "Halo"</em>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="个人微信二维码">
</p>

---

## Halo 的故事

2025 年 10 月，一个简单的困扰：**我想用 Claude Code，但整天都在开会。**

在无聊的会议中，我想：*如果能从手机控制家里电脑上的 Claude Code 呢？*

然后是第二个问题 —— 非技术同事也想用，但卡在了安装环节。*"什么是 npm？"*

所以我做了 Halo：可视化界面、一键安装、远程访问。第一版用了几个小时。之后的所有功能，**100% 由 Halo 自己构建。**

现在，我们相信下一步是 **AI 工作站**：AI 不再需要人盯着才能干活。你设定目标，数字人 7x24 自主推进。写代码、跑测试、监控部署、生成报告 —— 持续运转，你只在关键节点决策。

这就是 Halo 正在做的事。

---

## 许可证

MIT — [LICENSE](../LICENSE)

---

<div align="center">

## 贡献者

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**Star 这个仓库**，帮助更多人发现 Halo。

[![Star History Chart](https://api.star-history.com/svg?repos=openkursar/hello-halo&type=Date)](https://star-history.com/#openkursar/hello-halo&Date)

[⬆ 返回顶部](#halo)

</div>
