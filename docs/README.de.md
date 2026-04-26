<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Desktop AI Agent. Code, automate, run 7x24.

Die volle Leistung von Claude Code, ohne Terminal.
Code schreiben, Browser steuern, Digitale Menschen erstellen -- deine KI, rund um die Uhr einsatzbereit.

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#installation)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**Download**](#installation) · [**Dokumentation**](#dokumentation) · [**Mitwirken**](#mitwirken)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **[Français](./README.fr.md)** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: Ersetzen durch ein 30-Sekunden-GIF: Benutzer gibt einen Satz ein -> Agent schreibt automatisch Code -> Datei erscheint im Artifact Rail -> Vorschau -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## Warum Halo?

Halo baut auf [Claude Code](https://github.com/anthropics/claude-code) auf und bietet eine vollstaendige Produkterfahrung mit insgesamt ueber 300.000 Zeilen Code, validiert durch zehntausende Nutzer und stabil im Unternehmenseinsatz. Darueber hinaus bietet Halo:

| Im Terminal nicht moeglich | Halo kann es |
|:---:|:---:|
| Jede von der KI generierte Datei sehen | **Artifact Rail** zeigt Code, HTML und Bilder in Echtzeit |
| Wenn du den Computer verlaesst, stoppt alles | **Fernzugriff** -- jederzeit weiter per Handy / H5 / WeChat / Android-Client |
| Jedes Mal manuell starten | **Digitale Menschen** laufen 7x24 automatisch |
| Fuer nicht-technische Kollegen nutzbar machen | **Herunterladen und loslegen**, keine Konfiguration noetig |
| Browser-Operationen automatisieren | **AI Browser** -- eingebetteter Browser, direkt von der KI gesteuert |

> Powered by [Claude Code](https://github.com/anthropics/claude-code) -- 100% kompatibel mit den Agent-Faehigkeiten, MCP und Skills von Claude Code.

---

## Deine KI braucht keine Aufsicht

Die meisten KI-Tools erfordern, dass du vor dem Bildschirm sitzt und Runde fuer Runde Dialoge fuehrst. Halo ist anders -- es kann selbststaendig arbeiten, du musst nur an entscheidenden Punkten Entscheidungen treffen.

### Digitale Menschen -- 7x24 autonom arbeitende KI-Mitarbeiter

Erstelle einen Digitalen Menschen, gib ihm eine Aufgabe und eine Ausfuehrungsfrequenz, und er wird planmaessig selbststaendig arbeiten:

- Jeden Morgen eine Zusammenfassung der Tech-Nachrichten senden
- Stuendlich den Status der Online-Dienste pruefen und dich bei Anomalien benachrichtigen
- Regelmaessig Wettbewerbsanalysen durchfuehren und Vergleichsberichte erstellen
- GitHub-Abhaengigkeiten auf Updates und Sicherheitsluecken ueberwachen
- Erwaehungen von Schluesselbegriffen in sozialen Medien verfolgen

Im **Digital Human Store** mit einem Klick installieren oder mit natuerlicher Sprache eigene erstellen.

> Stell es dir als Kombination aus Cron-Job und KI-Agent vor -- aber du musst nur normale Sprache verwenden.

Digitale Menschen verfuegen ueber exakt die gleichen Agent-Faehigkeiten wie der Konversationsmodus -- dieselbe Claude-Engine, MCP-Toolchain und den AI Browser, nur dass sie planmaessig automatisch ausgeloest werden, ohne dass du am Computer sitzen musst.

**WeChat ist deine Steuerzentrale.** Digitale Menschen unterstuetzen die bidirektionale Dialogsteuerung ueber persoenliches WeChat / WeCom -- nicht nur Benachrichtigungen empfangen, du kannst dem Digitalen Menschen direkt in WeChat Anweisungen geben, den Fortschritt abfragen und Berichte anfordern.

![AI Digital Human](./assets/ai-digital-human.png)

### Browser Skill -- Zuverlaessige KI-gesteuerte Website-Bedienung

Herkoemmliche KI-Browser-Automatisierung laesst die KI jedes Mal selbst herausfinden, wo sie klicken und was sie eingeben soll -- das geht oft schief.

Browser Skill verfolgt einen anderen Ansatz: **Haeufig verwendete Aktionen fuer jede Website werden vorab als wiederverwendbare Skripte geschrieben**. Die KI muss nur entscheiden "welches Skript soll jetzt aufgerufen werden" -- wie die Website genau bedient wird, hat das Skript bereits erledigt.

Skill-Skripte laufen ueber Halos `browser_run` direkt in einer echten Browser-Umgebung -- mit Zugriff auf Seiten-DOM, Cookies und interne APIs, genau wie in der Chrome DevTools-Konsole. Hier ein Beispiel fuer den Kerncode eines Bilibili-Benachrichtigungs-Skills:

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  // Bilibili-interne API direkt aufrufen -- Cookies werden automatisch mitgesendet, keine zusaetzliche Authentifizierung noetig
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'
  }).then(r => r.json())

  // Strukturierte Daten an die KI zurueckgeben, die KI entscheidet, wie sie antwortet
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

Der Digitale Mensch ruft es einfach so auf: `browser_run({ file: "skills/bili-get-messages/index.js" })` -- nach Erhalt der Daten entscheidet die KI selbst, welche beantwortet werden muessen und wie.

Zum Beispiel der Workflow eines Zhihu-Digitalen-Menschen:
1. KI entscheidet: Zeit zu pruefen, ob es neue Einladungen zum Antworten gibt
2. Ruft `zhihu-creator-invited` Skill auf -> Skript holt automatisch die Einladungsliste und gibt strukturierte Daten zurueck
3. KI urteilt: Diese Frage ist es wert, beantwortet zu werden, beginnt zu schreiben
4. Ruft `zhihu-publish-answer` Skill auf -> Skript fuellt automatisch den Editor aus und veroeffentlicht

Die KI trifft Entscheidungen, Skills fuehren Aktionen aus. Stabil, wiederholbar, zuverlaessig.

Derzeit gibt es fertige Skills fuer Plattformen wie Bilibili, Zhihu, WeChat, Xiaohongshu und weitere. Die Community kann auch eigene beitragen.

### Fernzugriff -- Dein Handy als KI-Fernbedienung

Wenn der Fernzugriff aktiviert ist, kannst du Halo auf deinem Desktop per Handy / H5 / WeChat / Android-Client steuern. Im Meeting, beim Pendeln oder sogar im Krankenhausbett (wahre Geschichte) -- jederzeit den Arbeitsfortschritt der KI einsehen und neue Anweisungen geben.

---

## Schnellstart

**In 30 Sekunden loslegen:**

1. [Herunterladen und installieren](#installation), Halo starten
2. API Key eingeben (Anthropic empfohlen)
3. Beginne zu chatten -- probiere `Schreibe eine Todo-App mit React` oder `Hilf mir, die Code-Struktur dieses Projekts zu analysieren`
4. Beobachte, wie Dateien im Artifact Rail erscheinen, klicke zur Vorschau und fordere Aenderungen an

> Empfohlene Modelle: Claude Sonnet / Opus Serie

---

## Installation

### Download (Empfohlen)

| Plattform | Download | Anforderungen |
|------|------|------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | Aus Quellcode kompilieren | iOS 15+ |

**Herunterladen, installieren, ausfuehren.** Kein Node.js, kein npm, kein Terminal noetig.

### Aus Quellcode kompilieren

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

### Fuer Nutzer -- Sofort einsatzbereit

Oeffne den Digital Human Store, waehle einen aus, fuelle ein paar Konfigurationsfelder aus, und er beginnt automatisch zu arbeiten. Kein Code schreiben, keine Prompts verfassen.

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### Fuer Entwickler -- Erstellen und veroeffentlichen

Schreibe eine `spec.yaml` und reiche einen PR beim [Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol) ein. Nach dem Merge ist er sofort fuer alle Halo-Nutzer verfuegbar.

Du kannst auch Browser Skills (`.js`-Skripte) fuer Digitale Menschen schreiben, damit sie auf bestimmten Plattformen praezise Aktionen ausfuehren.

</td>
</tr>
</table>

---

## Screenshots

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*Fernzugriff: Halo von ueberall steuern*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="Mobiler Fernzugriff">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="Mobiler Chat">
</p>

*AI Browser*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## Architektur

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
│                     ~/.halo/ (lokal)              │
└──────────────────────────────────────────────────┘
```

- **100% lokal** -- Daten verlassen deinen Computer nicht (ausser API-Aufrufe)
- **Kein Backend noetig** -- Reiner Desktop-Client, mit deinem eigenen API Key
- **Agent Loop** -- Tool-Ausfuehrung, nicht nur Textgenerierung

---

## Weitere Faehigkeiten

- **Space-System** -- Isolierte Arbeitsbereiche, Projekte stoeren sich nicht gegenseitig
- **Skills** -- Skill-Pakete installieren, um die Agent-Faehigkeiten zu erweitern
- **AI Browser** -- Eingebetteter CDP-Browser, KI steuert Webseiten direkt
- **Multi-Modell-Unterstuetzung** -- Anthropic, OpenAI, DeepSeek und jede OpenAI-kompatible API
- **Dunkles/Helles Design** -- Folgt dem System
- **Mehrsprachig** -- Chinesisch, Englisch, Spanisch und mehr

---

## Roadmap

- [x] Claude Code SDK Agent Loop
- [x] Space- und Konversationsverwaltung
- [x] Artifact-Vorschau (Code, HTML, Bilder, Markdown)
- [x] Fernzugriff
- [x] AI Browser (CDP)
- [x] MCP-Server-Unterstuetzung
- [x] Skills-System
- [x] Digitale Menschen und Digital Human Store
- [ ] Kompatibilitaet mit Drittanbieter-Oekosystem-Plugins
- [ ] Verbesserte Code-Editiererfahrung
- [ ] Git-Visualisierung + KI-gestuetzte Code-Review
- [ ] KI-gesteuerte Dateisuche

---

## Mitwirken

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **Uebersetzungen** -- `src/renderer/i18n/`
- **Bug-Reports** -- [Issues](https://github.com/openkursar/hello-halo/issues)
- **Feature-Vorschlaege** -- [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **Code-Beitraege** -- PRs willkommen

Siehe [CONTRIBUTING.md](../CONTRIBUTING.md) fuer Details.

---

## Community

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/49f1040c-b858-4d43-841b-206310d3c33f" width="200" alt="WeChat-Gruppen-QR-Code">
</p>
<p align="center">
  <em>Falls der QR-Code abgelaufen ist, fuege WeChat hinzu: go2halo mit dem Vermerk "Halo"</em>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="Persoenlicher WeChat-QR-Code">
</p>

---

## Die Geschichte von Halo

Im Oktober 2025 begann es mit einer einfachen Frustration: **Ich wollte Claude Code nutzen, aber ich steckte den ganzen Tag in Meetings.**

Waehrend langweiliger Meetings dachte ich: *Was, wenn ich Claude Code auf meinem Heimcomputer vom Handy aus steuern koennte?*

Dann kam das zweite Problem -- nicht-technische Kollegen wollten es auch nutzen, blieben aber bei der Installation haengen. *"Was ist npm?"*

Also baute ich Halo: visuelle Oberflaeche, Ein-Klick-Installation, Fernzugriff. Die erste Version brauchte nur ein paar Stunden. Alles danach wurde **100% von Halo selbst gebaut.**

Jetzt glauben wir, dass der naechste Schritt die **KI-Workstation** ist: Die KI braucht keinen Menschen mehr, der ihr zuschaut. Du setzt ein Ziel, und Digitale Menschen arbeiten 7x24 autonom daran. Code schreiben, Tests ausfuehren, Deployments ueberwachen, Berichte erstellen -- kontinuierlich im Betrieb, du entscheidest nur an kritischen Punkten.

Das ist es, woran Halo arbeitet.

---

## Lizenz

MIT -- [LICENSE](../LICENSE)

---

<div align="center">

## Mitwirkende

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**Gib diesem Repository einen Star**, um anderen zu helfen, Halo zu entdecken.

[![Star History Chart](https://api.star-history.com/svg?repos=openkursar/hello-halo&type=Date)](https://star-history.com/#openkursar/hello-halo&Date)

[Zurueck nach oben](#halo)

</div>
