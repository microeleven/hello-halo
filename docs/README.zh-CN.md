<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### 你的 AI 工作站 — 面向团队与个人

本地部署，全天候自动化。AI 数字人替你干活，你只需做决策。

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#安装)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**下载**](#安装) · [**文档**](#文档) · [**参与贡献**](#参与贡献)

**[English](../README.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **[Deutsch](./README.de.md)** | **[Français](./README.fr.md)** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: 替换为 30 秒 GIF：用户输入一句话 -> Agent 自动写代码 -> 文件出现在 Artifact Rail -> 预览结果 -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## 为什么选择 Halo？

Halo 是一个基于前沿 Agent 能力构建的 AI 工作站，采用可插拔引擎架构，支持 [Claude Code](https://github.com/anthropics/claude-code)、[Codex](https://github.com/openai/codex) 等。产品层累计超过 30 万行代码，经过数万用户验证，在企业环境中稳定运行。Halo 提供：

| Halo 的核心能力 |
|:---:|
| **你的日常 AI 伙伴** — 写代码、做产品、搞运营、写文案、做调研，日常工作的全能搭档 |
| **100% 本地运行，零云端依赖** — 数据不出本机，满足企业合规审计要求 |
| **AI 数字人** — 7x24 自主运行的 AI 员工，处理监控、报表、日常操作 |
| **AI 浏览器** — 内嵌浏览器由 AI 直接控制，可自动化任何 Web 系统 |
| **企业微信 / 微信原生控制** — 在企业 IM 中管理 AI Agent，零培训成本 |
| **远程访问** — 手机 / H5 / 微信 / Android 随时控制，管理者移动端审阅进度 |
| **下载即用** — 零配置、无需后端，IT 几分钟完成部署 |

> 100% 兼容 Claude Code 的 Agent 能力、MCP 和 Skills。

---

## AI 数字人 — 你的自主 AI 劳动力

传统 RPA 按固定脚本执行，遇到变化就崩。Halo 的做法不同：**AI 负责判断决策，Halo Browser Skill 负责精准执行。** 结果就是——能理解上下文、能适应变化、能精准操作的自动化。

### 自主运行的 Agent，7x24 不停歇

创建一个 AI 数字人，给它一个任务和执行频率，它就会按计划自主运行。不用盯屏幕，不用维护脚本。

**社交与内容平台自动化：**

- 自动回复小红书、B站、知乎的评论和私信
- 定时在 Twitter / X、微信公众号发布内容
- 监控品牌提及和竞品动态，生成每日摘要
- 追踪热门话题，自动起草内容建议

**企业内部自动化：**

- 巡检内部 OA / CRM / ERP 系统，标记逾期工单和异常
- 从 Jira / GitLab / GitHub 活动中生成每日站会报告
- 监控 CI/CD 流水线，构建失败时通知并自动创建事故工单
- 定期执行内部仪表盘合规检查
- 跨部门采集数据，汇总周报

从 **AI 数字人商店** 一键安装，为企业部署**私有商店**，或用自然语言自行创建。

> 把它想成 cron + RPA + AI Agent 的合体——只不过你用自然语言描述需求就行。

AI 数字人拥有与对话模式完全相同的 Agent 能力——同样的 Claude 引擎、MCP 工具链和 AI 浏览器——只是它们按计划自动触发，不需要你坐在电脑前。

**微信 / 企业微信就是你的控制面板。** AI 数字人支持通过个人微信 / 企业微信进行双向对话控制——不只是接收通知，你可以直接在企业 IM 中给数字人下指令、查进度、要报告。

![AI Digital Human](./assets/ai-digital-human.png)

### Halo Browser Skill — AI 决策，脚本执行

这是 Halo 和那些"AI 浏览器 Agent 到处乱点"的根本区别。

Halo Browser Skill 采用 RPA 级别的可靠性策略：**为每个平台的常用操作预先编写可复用脚本**。AI 只负责决定*做什么*和*什么时候做*——脚本已经知道*怎么做*。

脚本通过 Halo 的 `browser_run` 直接在真实浏览器中运行，完全访问页面 DOM、Cookie 和内部 API，就像在 Chrome DevTools 控制台操作一样。公开网站和企业内网系统都适用。

**示例：读取 B 站通知**

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'  // 自动携带 Cookie，无需额外认证
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

AI 调用方式：`browser_run({ file: ".claude/skills/bili-get-messages/index.js" })`

**示例：企业工作流 — 小红书内容运营数字人：**
1. AI 判断：该检查今天帖子的新评论了
2. 调用 `xhs-get-comments` Skill → 脚本通过平台 API 获取评论列表
3. AI 判断：这 5 条评论需要回复，起草个性化回复
4. 调用 `xhs-reply-comment` Skill → 脚本逐条提交回复

**示例：企业内部 — DevOps 监控数字人：**
1. AI 判断：到了每小时基础设施检查时间
2. 调用 `check-grafana-alerts` Skill → 脚本通过内部 API 读取告警仪表盘
3. AI 判断：2 个告警是严重级别，撰写事故摘要
4. 调用 `create-jira-ticket` Skill → 脚本创建 P1 工单并附完整上下文
5. 调用 `notify-oncall` Skill → 推送告警到企业微信值班群

**AI 决策，Skill 执行。稳定、可复用、可审计。**

已有现成 Skill 覆盖小红书、B站、知乎、Twitter / X、微信等平台。企业团队可以为内部系统编写私有 Skill。社区也可以贡献和分享。

### 远程访问 — 随时随地管理你的 AI 团队

开启远程访问后，手机 / H5 / 微信 / Android 客户端都能控制桌面上的 Halo。开会时、通勤中、在路上——随时查看数字人产出、审批决策、下达新指令，无需坐在工位上。

---

## 快速开始

**30 秒上手：**

1. [下载安装](#安装)，启动 Halo
2. 输入你的 API Key（推荐 Anthropic）
3. 开始对话——试试 `用 React 做一个待办应用` 或 `帮我分析这个项目的代码结构`
4. 在 Artifact Rail 中看到文件出现，点击预览，提出修改意见

> 推荐模型：Claude Sonnet / Opus 系列

---

## 安装

### 下载安装（推荐）

| 平台 | 下载 | 系统要求 |
|------|------|----------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | 源码构建 | iOS 15+ |

**下载、安装、运行。** 无需 Node.js、npm 或终端。IT 可以零服务端依赖地在全组织分发。

### 从源码构建

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## AI 数字人商店

<table>
<tr>
<td width="50%" valign="top">

### 面向用户 — 一键安装即用

打开 AI 数字人商店，选一个，填几个配置字段，就自动开始运行。无需写代码，无需写提示词。

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### 面向开发者 — 构建与发布

编写 `spec.yaml` 并向 [AI 数字人协议 (DHP)](https://github.com/openkursar/digital-human-protocol) 提交 PR。合并后，所有 Halo 用户即可使用。

你也可以编写 Halo Browser Skill（`.js` 脚本），让 AI 数字人精准执行特定平台上的操作。

</td>
</tr>
</table>

---

## 截图

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*远程访问：随时随地控制 Halo*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="Mobile Remote Access">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="Mobile Chat">
</p>

*AI 浏览器*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## 架构

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

## 更多功能

- **100% 本地** — 数据不出本机，满足企业合规审计要求
- **无需后端** — 纯桌面客户端，零服务端基础设施即可部署到每台工位
- **Agent 循环** — 工具执行，不只是文本生成
- **空间系统** — 隔离的工作区，项目互不干扰
- **技能系统** — 安装技能包扩展 Agent 能力
- **AI 浏览器** — 内嵌 CDP 浏览器，AI 直接控制网页
- **多模型支持** — Anthropic、OpenAI、DeepSeek 及任何 OpenAI 兼容 API（可对接企业自建 LLM 网关）
- **明暗主题** — 跟随系统偏好
- **多语言** — 中文、英文、西班牙语等

[**查看全部功能 →**](https://hello-halo.cc/docs/features/spaces.html)

---

## 路线图

- [x] Claude Code SDK Agent 循环
- [x] 空间与会话管理
- [x] Artifact 预览（代码、HTML、图片、Markdown）
- [x] 远程访问
- [x] AI 浏览器（CDP）
- [x] MCP Server 支持
- [x] 技能系统
- [x] AI 数字人与 AI 数字人商店
- [ ] 第三方生态插件兼容
- [ ] 增强代码编辑体验
- [ ] 可视化 Git + AI 辅助 Code Review
- [ ] AI 驱动的文件搜索
- [ ] 低成本数字人录制 — 自动录制并回放 AI 工作流，生成可复用的数字人

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
- **代码贡献** — 欢迎 PR

详见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

---

## 社区

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="个人微信二维码">
</p>
<p align="center">
  <em>任何反馈和交流，欢迎添加微信：go2halo，备注 "Halo"</em>
</p>

---

## Halo 的故事

2025 年 10 月，一个简单的困扰：**我想用 Claude Code，但整天在开会。**

在一个无聊的会议上，我想：*如果能用手机遥控家里电脑上的 Claude Code 呢？*

然后是第二个问题——非技术同事也想用，但卡在了安装上。*"npm 是什么？"*

于是我做了 Halo：可视化界面、一键安装、远程访问。第一个版本花了几个小时。之后的一切？**100% 由 Halo 自己构建。**

如今，我们相信下一步是 **AI 工作站**：AI 不再需要有人盯着才能干活。你设定目标，AI 数字人 7x24 自主推进。写代码、跑测试、监控部署、生成报告——持续运转，你只在关键节点做决策。

这就是 Halo 在做的事。

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

</div>

---

## 合作伙伴与赞助商

如果 Halo 启发了你的项目，或者你基于 Halo 构建了新产品，欢迎提到我们。

### 企业合作伙伴

<!-- 在此添加你的企业 logo — 提交 PR 或通过下方链接联系我们 -->

| 你的公司在使用 Halo？ | [告诉我们](https://github.com/openkursar/hello-halo/issues/new?title=Add+our+company+as+partner) — 我们很乐意在此展示。 |
|:---:|:---:|

### 赞助商

<a href="https://www.nnscholar.com/">
  <img src="https://www.nnscholar.com/favicon.ico" height="40" alt="NNScholar">
</a>

<p align="center">
  <a href="https://ifdian.net/a/hello-halo">爱发电（支付宝 / 微信）</a> · <a href="https://buy.polar.sh/polar_cl_x7bTGvMvt3rbUt6oE98z0zb2zFz1sT7dG37BA3foNsZ">Polar（国际信用卡）</a>
</p>

---

<div align="center">

[回到顶部](#halo)

</div>
