<div align="center">

<img src="./resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Your AI Workstation — For Teams and Individuals

Deploy locally. Automate around the clock. AI Digital Humans work while you make the calls.

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#installation)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**Download**](#installation) · [**Documentation**](#documentation) · [**Contributing**](#contributing)

**[简体中文](./docs/README.zh-CN.md)** | **[繁體中文](./docs/README.zh-TW.md)** | **[Español](./docs/README.es.md)** | **[Deutsch](./docs/README.de.md)** | **[Français](./docs/README.fr.md)** | **[日本語](./docs/README.ja.md)**

</div>

<!-- TODO: Replace with a 30-second GIF showing: user types a sentence -> Agent automatically writes code -> files appear in Artifact Rail -> preview the result -->
<div align="center">

![Space Home](./docs/assets/space_home.jpg)

</div>

---

## Why Halo?

Halo is an AI workstation powered by frontier Agent with a pluggable engine architecture — supporting [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex), and more. With a complete product layer totaling over 300,000 lines of code, validated by tens of thousands of users, and running stably in enterprise environments, Halo delivers:

| What Halo delivers |
|:---:|
| **Your Daily AI Partner** — coding, product design, operations, writing, research — your everyday work companion |
| **100% Local, Zero Cloud Dependency** — data never leaves your machine, meets enterprise compliance requirements |
| **AI Digital Humans** — AI workers running autonomously 7x24, handling monitoring, reports, and routine operations |
| **AI Browser** — embedded browser directly controlled by AI, automate any web-based system |
| **WeCom / WeChat Native Control** — manage AI agents from enterprise IM, zero training cost |
| **Remote Access** — control from phone / H5 / WeChat / Android, managers review progress on the go |
| **Download and Go** — zero configuration, no backend required, IT deploys in minutes |

> 100% compatible with Claude Code's Agent capabilities, MCP, and Skills.

---

## AI Digital Humans — Your Autonomous AI Workforce

Traditional RPA follows rigid scripts and breaks when anything changes. Halo takes a different approach: **AI makes the decisions, Halo Browser Skills handle the operations.** The result is automation that understands context, adapts to changes, and executes with precision.

### Autonomous Agents Running 7x24

Create an AI Digital Human, give it a task and an execution frequency, and it runs autonomously on schedule. No screen to watch, no scripts to babysit.

**Social & Content Platform Automation:**

- Auto-reply to comments and DMs on Xiaohongshu, Bilibili, Zhihu
- Publish scheduled content across Twitter / X, WeChat Official Accounts
- Monitor brand mentions and competitor activity, generate daily digests
- Track trending topics and automatically draft content suggestions

**Enterprise Internal Automation:**

- Patrol internal OA / CRM / ERP systems, flag overdue tickets and anomalies
- Generate daily standup reports from Jira / GitLab / GitHub activity
- Monitor CI/CD pipelines, notify on build failures, auto-create incident tickets
- Run scheduled compliance checks on internal dashboards
- Collect cross-department data and assemble weekly executive summaries

Install with one click from the **AI Digital Human Store**, deploy a **private store** for your organization, or create your own using natural language.

> Think of it as cron + RPA + AI Agent in one — except you just describe what you want in plain language.

AI Digital Humans have the exact same Agent capabilities as conversation mode — the same Claude engine, MCP toolchain, and AI Browser — they just trigger automatically on schedule without needing you at the computer.

**WeChat / WeCom is your control panel.** AI Digital Humans support two-way conversational control via personal WeChat / WeCom (Enterprise WeChat) — not just receiving notifications, you can give instructions, check progress, and request reports directly in your enterprise IM.

![AI Digital Human](./docs/assets/ai-digital-human.png)

### Halo Browser Skill — AI Decides, Scripts Execute

This is what separates Halo from "AI browser agents" that fumble around clicking randomly.

Halo Browser Skill takes the RPA approach to reliability: **pre-write reusable scripts for common operations on each platform**. The AI only decides *what* to do and *when* — the script already knows *how*.

Scripts run directly in a real browser via Halo's `browser_run` — with full access to the page DOM, cookies, and internal APIs, just like the Chrome DevTools Console. This works for public platforms and private enterprise systems alike.

**Example: Reading Bilibili notifications**

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

AI calls it with: `browser_run({ file: ".claude/skills/bili-get-messages/index.js" })`

**Example: Enterprise workflow — a Xiaohongshu content operations Digital Human:**
1. AI decides: time to check for new comments on today's posts
2. Calls `xhs-get-comments` Skill → script fetches comment list via platform API
3. AI judges: these 5 comments need replies, drafts personalized responses
4. Calls `xhs-reply-comment` Skill → script submits each reply

**Example: Enterprise internal — a DevOps monitoring Digital Human:**
1. AI decides: time for the hourly infra check
2. Calls `check-grafana-alerts` Skill → script reads alert dashboard via internal API
3. AI judges: 2 alerts are critical, composes an incident summary
4. Calls `create-jira-ticket` Skill → script creates a P1 ticket with full context
5. Calls `notify-oncall` Skill → pushes alert to WeCom on-call group

**AI decides. Skills execute. Stable, repeatable, auditable.**

Ready-made Skills are available for Xiaohongshu, Bilibili, Zhihu, Twitter / X, WeChat, and more. Enterprise teams can write private Skills for internal systems. The community can contribute and share their own.

### Remote Access — Manage Your AI Fleet From Anywhere

Once Remote Access is enabled, your phone / H5 / WeChat / Android client can control Halo on your desktop. During meetings, commuting, or on the road — check Digital Human outputs, approve decisions, and issue new instructions without being at your desk.

---

## Quick Start

**Get started in 30 seconds:**

1. [Download and install](#installation), launch Halo
2. Enter your API Key (Anthropic recommended)
3. Start chatting — try `Build a todo app with React` or `Help me analyze the code structure of this project`
4. Watch files appear in the Artifact Rail, click to preview, request changes

> Recommended models: Claude Sonnet / Opus series

---

## Installation

### Download (Recommended)

| Platform | Download | Requirements |
|----------|----------|--------------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | Build from source | iOS 15+ |

**Download, install, run.** No Node.js, no npm, no terminal needed. IT can distribute across the organization with zero server-side dependencies.

### Build from Source

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## AI Digital Human Store

<table>
<tr>
<td width="50%" valign="top">

### For Users — Install and Use Instantly

Open the AI Digital Human Store, pick one, fill in a few configuration fields, and it starts running automatically. No coding required, no prompts to write.

![AI Store](./docs/assets/shop.png)

</td>
<td width="50%" valign="top">

### For Developers — Build and Publish

Write a `spec.yaml` and submit a PR to the [AI Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol). Once merged, it becomes immediately available to all Halo users.

You can also write Halo Browser Skills (`.js` scripts) for AI Digital Humans to precisely execute operations on specific platforms.

</td>
</tr>
</table>

---

## Screenshots

![Chat Intro](./docs/assets/chat_intro.jpg)

![Chat Todo](./docs/assets/chat_todo.jpg)

*Remote Access: Control Halo from anywhere*

![Remote Settings](./docs/assets/remote_setting.jpg)

<p align="center">
  <img src="./docs/assets/mobile_remote_access.jpg" width="45%" alt="Mobile Remote Access">
  &nbsp;&nbsp;
  <img src="./docs/assets/mobile_chat.jpg" width="45%" alt="Mobile Chat">
</p>

*AI Browser*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## Architecture

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

## More Features

- **100% Local** — Your data never leaves your machine, meets enterprise compliance requirements
- **No Backend Required** — Pure desktop client, deploy to every workstation with zero server infrastructure
- **Agent Loop** — Tool execution, not just text generation
- **Space System** — Isolated workspaces, projects don't interfere with each other
- **Skills** — Install skill packs to extend Agent capabilities
- **AI Browser** — Embedded CDP browser, AI directly controls web pages
- **Multi-Model Support** — Anthropic, OpenAI, DeepSeek, and any OpenAI-compatible API (connect to your enterprise LLM gateway)
- **Dark/Light Themes** — Follows system preference
- **Multi-Language** — Chinese, English, Spanish, and more

[**Explore all features →**](https://hello-halo.cc/docs/features/spaces.html)

---

## Roadmap

- [x] Claude Code SDK Agent Loop
- [x] Space and Conversation Management
- [x] Artifact Preview (Code, HTML, Images, Markdown)
- [x] Remote Access
- [x] AI Browser (CDP)
- [x] MCP Server Support
- [x] Skills System
- [x] AI Digital Humans and AI Digital Human Store
- [ ] Third-party Ecosystem Plugin Compatibility
- [ ] Enhanced Code Editing Experience
- [ ] Visual Git + AI-Assisted Code Review
- [ ] AI-Powered File Search
- [ ] Low-Cost Digital Human Recording — auto-record and replay AI workflows as reusable Digital Humans

---

## Contributing

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **Translations** — `src/renderer/i18n/`
- **Bug Reports** — [Issues](https://github.com/openkursar/hello-halo/issues)
- **Feature Suggestions** — [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **Code Contributions** — PRs welcome

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Community

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="Personal WeChat QR Code">
</p>
<p align="center">
  <em>For any feedback or discussion, add WeChat: go2halo with the note "Halo"</em>
</p>

---

## The Story of Halo

In October 2025, a simple frustration: **I wanted to use Claude Code, but I was stuck in meetings all day.**

During a boring meeting, I thought: *What if I could control Claude Code on my home computer from my phone?*

Then came the second problem — non-technical colleagues wanted to use it too, but got stuck at installation. *"What's npm?"*

So I built Halo: a visual interface, one-click install, remote access. The first version took a few hours. Everything after that? **100% built by Halo itself.**

Now, we believe the next step is the **AI Workstation**: AI no longer needs someone watching to get work done. You set the goals, AI Digital Humans push forward autonomously 7x24. Writing code, running tests, monitoring deployments, generating reports — running continuously, with you only making decisions at key checkpoints.

That's what Halo is building.

---

## License

MIT — [LICENSE](LICENSE)

---

<div align="center">

## Contributors

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**Star this repo** to help more people discover Halo.

</div>

---

## Partners & Sponsors

If Halo inspired your project or you built something on top of it, a mention would mean a lot.

### Enterprise Partners

<!-- Add your company logo here — submit a PR or contact us at the link below -->

| Your company uses Halo? | [Let us know](https://github.com/openkursar/hello-halo/issues/new?title=Add+our+company+as+partner) — we'd love to feature you here. |
|:---:|:---:|

### Sponsors

<a href="https://www.nnscholar.com/">
  <img src="https://www.nnscholar.com/favicon.ico" height="40" alt="NNScholar">
</a>

<p align="center">
  <a href="https://buy.polar.sh/polar_cl_x7bTGvMvt3rbUt6oE98z0zb2zFz1sT7dG37BA3foNsZ">Polar (International)</a> · <a href="https://ifdian.net/a/hello-halo">爱发电 (Alipay / WeChat)</a>
</p>

---

<div align="center">

[Back to Top](#halo)

</div>
