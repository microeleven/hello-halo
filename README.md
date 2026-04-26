<div align="center">

<img src="./resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Desktop AI Agent. Code, automate, run 7x24.

All the power of Claude Code, no terminal required.
Write code, control browsers, create Digital Humans — your AI, on standby around the clock.

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

Halo is built on top of [Claude Code](https://github.com/anthropics/claude-code), with a complete product layer totaling over 300,000 lines of code, validated by tens of thousands of users, and running stably in enterprise environments. On top of that, Halo also delivers:

| What the terminal can't do | Halo can |
|:---:|:---:|
| See every file AI generates | **Artifact Rail** previews code, HTML, and images in real time |
| Stops when you leave the computer | **Remote Access** — continue anytime from phone / H5 / WeChat / Android client |
| Have to start manually every time | **Digital Humans** run automatically 7x24 |
| Let non-technical colleagues use it | **Download and go**, zero configuration |
| Automate browser operations | **AI Browser** — embedded browser directly controlled by AI |

> Powered by [Claude Code](https://github.com/anthropics/claude-code) — 100% compatible with Claude Code's Agent capabilities, MCP, and Skills.

---

## Your AI Doesn't Need You Watching

Most AI tools require you to sit in front of the screen, going back and forth in conversation. Halo is different — it can work on its own, and you only need to make decisions at key checkpoints.

### Digital Humans — AI Workers Running Autonomously 7x24

Create a Digital Human, give it a task and an execution frequency, and it will run autonomously on schedule:

- Push a tech news digest every morning
- Check online service status every hour and notify you of anomalies
- Run competitive analysis on a schedule and generate comparison reports
- Monitor GitHub dependency updates and security vulnerabilities
- Track keyword mentions across social media

Install with one click from the **Digital Human Store**, or create your own using natural language.

> Think of it as a cron job + AI Agent hybrid — except you just speak in plain language.

Digital Humans have the exact same Agent capabilities as conversation mode — the same Claude engine, MCP toolchain, and AI Browser — they just trigger automatically on schedule without needing you at the computer.

**WeChat is your control panel.** Digital Humans support two-way conversational control via personal WeChat / WeCom (Enterprise WeChat) — not just receiving notifications, you can give instructions to Digital Humans, check progress, and request reports directly in WeChat.

![AI Digital Human](./docs/assets/ai-digital-human.png)

### Browser Skill — Making AI-Driven Website Operations Stable and Reliable

Typical AI browser automation has the AI fumble around figuring out what to click and fill every time, which frequently fails.

Browser Skill takes a different approach: **pre-write reusable scripts for common operations on each website**. The AI only needs to decide "which script to call now" — the script already handles the specifics of how to operate the website.

Skill scripts run directly in a real browser environment via Halo's `browser_run` — with access to the page DOM, cookies, and internal APIs, just like operating in the Chrome DevTools console. For example, here is the core code of a Bilibili notification reading Skill:

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  // Directly call Bilibili's internal API — cookies are automatically included, no extra authentication needed
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'
  }).then(r => r.json())

  // Return structured data to the AI, which decides how to respond
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

When a Digital Human calls it, all it takes is: `browser_run({ file: "skills/bili-get-messages/index.js" })` — after getting the data, the AI decides which items need replies and how to reply.

For example, a Zhihu Digital Human's workflow:
1. AI decides: time to check for new invited questions
2. Calls `zhihu-creator-invited` Skill -> script automatically fetches the invitation list and returns structured data
3. AI judges: this question is worth answering, starts writing
4. Calls `zhihu-publish-answer` Skill -> script automatically fills the editor and publishes

AI makes the decisions, Skills handle the operations. Stable, repeatable, reliable.

There are already ready-made Skills for platforms like Bilibili, Zhihu, WeChat, Xiaohongshu, and more. The community can also contribute their own.

### Remote Access — Your Phone Is Your AI Remote Control

Once Remote Access is enabled, your phone / H5 / WeChat / Android client can all control the Halo on your desktop. During meetings, commuting, or even from a hospital bed (true story), check AI's work progress anytime and issue new instructions.

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

**Download, install, run.** No Node.js, no npm, no terminal needed.

### Build from Source

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## Digital Human Store

<table>
<tr>
<td width="50%" valign="top">

### For Users — Install and Use Instantly

Open the Digital Human Store, pick one, fill in a few configuration fields, and it starts running automatically. No coding required, no prompts to write.

![AI Store](./docs/assets/shop.png)

</td>
<td width="50%" valign="top">

### For Developers — Build and Publish

Write a `spec.yaml` and submit a PR to the [Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol). Once merged, it becomes immediately available to all Halo users.

You can also write Browser Skills (`.js` scripts) for Digital Humans to precisely execute operations on specific platforms.

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

- **100% Local** — Your data never leaves your machine (except API calls)
- **No Backend Required** — Pure desktop client, use your own API Key
- **Agent Loop** — Tool execution, not just text generation

---

## More Features

- **Space System** — Isolated workspaces, projects don't interfere with each other
- **Skills** — Install skill packs to extend Agent capabilities
- **AI Browser** — Embedded CDP browser, AI directly controls web pages
- **Multi-Model Support** — Anthropic, OpenAI, DeepSeek, and any OpenAI-compatible API
- **Dark/Light Themes** — Follows system preference
- **Multi-Language** — Chinese, English, Spanish, and more

---

## Roadmap

- [x] Claude Code SDK Agent Loop
- [x] Space and Conversation Management
- [x] Artifact Preview (Code, HTML, Images, Markdown)
- [x] Remote Access
- [x] AI Browser (CDP)
- [x] MCP Server Support
- [x] Skills System
- [x] Digital Humans and Digital Human Store
- [ ] Third-party Ecosystem Plugin Compatibility
- [ ] Enhanced Code Editing Experience
- [ ] Visual Git + AI-Assisted Code Review
- [ ] AI-Powered File Search

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
  <img src="https://github.com/user-attachments/assets/49f1040c-b858-4d43-841b-206310d3c33f" width="200" alt="WeChat Group QR Code">
</p>
<p align="center">
  <em>If the QR code has expired, add WeChat: go2halo with the note "Halo"</em>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="Personal WeChat QR Code">
</p>

---

## The Story of Halo

In October 2025, a simple frustration: **I wanted to use Claude Code, but I was stuck in meetings all day.**

During a boring meeting, I thought: *What if I could control Claude Code on my home computer from my phone?*

Then came the second problem — non-technical colleagues wanted to use it too, but got stuck at installation. *"What's npm?"*

So I built Halo: a visual interface, one-click install, remote access. The first version took a few hours. Everything after that? **100% built by Halo itself.**

Now, we believe the next step is the **AI Workstation**: AI no longer needs someone watching to get work done. You set the goals, Digital Humans push forward autonomously 7x24. Writing code, running tests, monitoring deployments, generating reports — running continuously, with you only making decisions at key checkpoints.

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

[![Star History Chart](https://api.star-history.com/svg?repos=openkursar/hello-halo&type=Date)](https://star-history.com/#openkursar/hello-halo&Date)

[Back to Top](#halo)

</div>
