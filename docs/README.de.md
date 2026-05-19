<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Deine KI-Arbeitsstation — Für Teams und Einzelpersonen

Lokal bereitstellen. Rund um die Uhr automatisieren. KI-Digitalmenschen arbeiten, während du die Entscheidungen triffst.

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#installation)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**Herunterladen**](#installation) · [**Dokumentation**](#dokumentation) · [**Mitwirken**](#mitwirken)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **Deutsch** | **[Français](./README.fr.md)** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: Replace with a 30-second GIF showing: user types a sentence -> Agent automatically writes code -> files appear in Artifact Rail -> preview the result -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## Warum Halo?

Halo ist eine KI-Arbeitsstation, angetrieben von einem hochmodernen Agent mit einer steckbaren Engine-Architektur — kompatibel mit [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex) und mehr. Mit einer vollständigen Produktschicht von über 300.000 Codezeilen, validiert von Zehntausenden von Nutzern und stabil in Unternehmensumgebungen laufend, bietet Halo:

| Was Halo bietet |
|:---:|
| **Dein täglicher KI-Partner** — Programmierung, Produktdesign, Betrieb, Schreiben, Recherche — dein alltäglicher Arbeitsbegleiter |
| **100% Lokal, Null Cloud-Abhängigkeit** — Daten verlassen niemals deinen Rechner, erfüllt Unternehmens-Compliance-Anforderungen |
| **KI-Digitalmenschen** — KI-Arbeiter, die autonom 7x24 laufen und Monitoring, Berichte und Routineoperationen übernehmen |
| **AI Browser** — Eingebetteter Browser, direkt von der KI gesteuert, automatisiert jedes webbasierte System |
| **Native WeCom / WeChat Steuerung** — Verwalte KI-Agenten über den Unternehmens-IM, ohne Schulungsaufwand |
| **Fernzugriff** — Steuerung vom Handy / H5 / WeChat / Android, Manager überprüfen den Fortschritt unterwegs |
| **Herunterladen und Loslegen** — Keine Konfiguration, kein Backend erforderlich, IT-Bereitstellung in Minuten |

> 100% kompatibel mit den Agent-Fähigkeiten von Claude Code, MCP und Skills.

---

## KI-Digitalmenschen — Deine Autonome KI-Belegschaft

Traditionelles RPA folgt starren Skripten und bricht zusammen, wenn sich etwas ändert. Halo geht einen anderen Weg: **Die KI trifft die Entscheidungen, Halo Browser Skills führen die Operationen aus.** Das Ergebnis ist Automatisierung, die den Kontext versteht, sich an Änderungen anpasst und präzise ausführt.

### Autonome Agenten im 7x24-Betrieb

Erstelle einen KI-Digitalmenschen, gib ihm eine Aufgabe und eine Ausführungsfrequenz, und er läuft autonom nach Zeitplan. Kein Bildschirm zu überwachen, keine Skripte zu beaufsichtigen.

**Automatisierung von Social Media und Content-Plattformen:**

- Automatische Antworten auf Kommentare und DMs auf Xiaohongshu, Bilibili, Zhihu
- Geplante Veröffentlichung von Inhalten auf Twitter / X, offiziellen WeChat-Accounts
- Überwachung von Markenerwähnungen und Wettbewerberaktivitäten, Erstellung täglicher Zusammenfassungen
- Verfolgung von Trendthemen und automatische Erstellung von Content-Vorschlägen

**Interne Unternehmensautomatisierung:**

- Überwachung interner OA / CRM / ERP-Systeme, Markierung überfälliger Tickets und Anomalien
- Erstellung täglicher Standup-Berichte aus Jira / GitLab / GitHub-Aktivitäten
- Überwachung von CI/CD-Pipelines, Benachrichtigung bei Build-Fehlern, automatische Erstellung von Incident-Tickets
- Durchführung geplanter Compliance-Prüfungen auf internen Dashboards
- Abteilungsübergreifende Datenerfassung und Erstellung wöchentlicher Management-Zusammenfassungen

Installiere mit einem Klick aus dem **KI-Digitalmensch-Store**, stelle einen **privaten Store** für deine Organisation bereit, oder erstelle eigene mit natürlicher Sprache.

> Stell es dir vor wie cron + RPA + AI Agent in einem — nur dass du einfach beschreibst, was du willst, in natürlicher Sprache.

KI-Digitalmenschen haben genau die gleichen Agent-Fähigkeiten wie der Konversationsmodus — den gleichen Claude-Engine, die MCP-Toolchain und den AI Browser — sie werden nur automatisch nach Zeitplan ausgelöst, ohne dass du am Computer sein musst.

**WeChat / WeCom ist deine Steuerzentrale.** KI-Digitalmenschen unterstützen bidirektionale Konversationssteuerung über persönliches WeChat / WeCom (Enterprise WeChat) — nicht nur Benachrichtigungen empfangen, du kannst Anweisungen geben, den Fortschritt prüfen und Berichte direkt im Unternehmens-IM anfordern.

![AI Digital Human](./assets/ai-digital-human.png)

### Halo Browser Skill — KI Entscheidet, Skripte Führen Aus

Das unterscheidet Halo von "KI-Browser-Agenten", die ziellos herumklicken.

Halo Browser Skill nutzt den RPA-Ansatz für Zuverlässigkeit: **Vorgefertigte wiederverwendbare Skripte für gängige Operationen auf jeder Plattform**. Die KI entscheidet nur *was* zu tun ist und *wann* — das Skript weiß bereits *wie*.

Skripte laufen direkt in einem echten Browser über Halos `browser_run` — mit vollem Zugriff auf das Seiten-DOM, Cookies und interne APIs, genau wie die Chrome DevTools Console. Das funktioniert sowohl für öffentliche Plattformen als auch für private Unternehmenssysteme.

**Beispiel: Bilibili-Benachrichtigungen lesen**

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

Die KI ruft es auf mit: `browser_run({ file: ".claude/skills/bili-get-messages/index.js" })`

**Beispiel: Unternehmens-Workflow — ein Xiaohongshu Content-Operations-Digitalmensch:**
1. Die KI entscheidet: Zeit, neue Kommentare zu den heutigen Beiträgen zu prüfen
2. Ruft den `xhs-get-comments` Skill auf → Skript holt die Kommentarliste über die Plattform-API
3. Die KI bewertet: Diese 5 Kommentare brauchen Antworten, verfasst personalisierte Antworten
4. Ruft den `xhs-reply-comment` Skill auf → Skript sendet jede Antwort

**Beispiel: Unternehmensintern — ein DevOps-Monitoring-Digitalmensch:**
1. Die KI entscheidet: Zeit für den stündlichen Infrastruktur-Check
2. Ruft den `check-grafana-alerts` Skill auf → Skript liest das Alert-Dashboard über die interne API
3. Die KI bewertet: 2 Alerts sind kritisch, erstellt eine Incident-Zusammenfassung
4. Ruft den `create-jira-ticket` Skill auf → Skript erstellt ein P1-Ticket mit vollständigem Kontext
5. Ruft den `notify-oncall` Skill auf → Sendet Alert an die WeCom-Bereitschaftsgruppe

**Die KI entscheidet. Skills führen aus. Stabil, wiederholbar, auditierbar.**

Fertige Skills sind verfügbar für Xiaohongshu, Bilibili, Zhihu, Twitter / X, WeChat und mehr. Unternehmensteams können private Skills für interne Systeme schreiben. Die Community kann eigene beitragen und teilen.

### Fernzugriff — Verwalte Deine KI-Flotte Von Überall

Sobald der Fernzugriff aktiviert ist, kann dein Handy / H5 / WeChat / Android-Client Halo auf deinem Desktop steuern. Während Meetings, auf dem Weg zur Arbeit oder unterwegs — prüfe die Ergebnisse der Digitalmenschen, genehmige Entscheidungen und erteile neue Anweisungen, ohne an deinem Schreibtisch zu sein.

---

## Schnellstart

**In 30 Sekunden starten:**

1. [Herunterladen und installieren](#installation), Halo starten
2. Gib deinen API Key ein (Anthropic empfohlen)
3. Beginne zu chatten — probiere `Build a todo app with React` oder `Help me analyze the code structure of this project`
4. Beobachte, wie Dateien im Artifact Rail erscheinen, klicke zur Vorschau, fordere Änderungen an

> Empfohlene Modelle: Claude Sonnet / Opus Serien

---

## Installation

### Download (Empfohlen)

| Plattform | Download | Anforderungen |
|----------|----------|--------------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | Aus dem Quellcode kompilieren | iOS 15+ |

**Herunterladen, installieren, starten.** Kein Node.js, kein npm, kein Terminal nötig. Die IT kann es organisationsweit verteilen — ohne serverseitige Abhängigkeiten.

### Aus dem Quellcode Kompilieren

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## KI-Digitalmensch-Store

<table>
<tr>
<td width="50%" valign="top">

### Für Nutzer — Sofort Installieren und Verwenden

Öffne den KI-Digitalmensch-Store, wähle einen aus, fülle ein paar Konfigurationsfelder aus, und er beginnt automatisch zu laufen. Keine Programmierung nötig, keine Prompts zu schreiben.

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### Für Entwickler — Erstellen und Veröffentlichen

Schreibe eine `spec.yaml` und reiche einen PR beim [AI Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol) ein. Nach dem Merge ist er sofort für alle Halo-Nutzer verfügbar.

Du kannst auch Halo Browser Skills (`.js`-Skripte) schreiben, damit KI-Digitalmenschen Operationen auf bestimmten Plattformen präzise ausführen können.

</td>
</tr>
</table>

---

## Screenshots

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*Fernzugriff: Steuere Halo von überall*

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

## Weitere Funktionen

- **100% Lokal** — Deine Daten verlassen niemals deinen Rechner, erfüllt Unternehmens-Compliance-Anforderungen
- **Kein Backend Erforderlich** — Reiner Desktop-Client, Bereitstellung auf jeder Arbeitsstation ohne Server-Infrastruktur
- **Agent Loop** — Werkzeugausführung, nicht nur Textgenerierung
- **Space-System** — Isolierte Arbeitsbereiche, Projekte beeinflussen sich nicht gegenseitig
- **Skills** — Installiere Skill-Pakete, um die Agent-Fähigkeiten zu erweitern
- **AI Browser** — Eingebetteter CDP-Browser, KI steuert Webseiten direkt
- **Multi-Modell-Unterstützung** — Anthropic, OpenAI, DeepSeek und jede OpenAI-kompatible API (Verbindung zu deinem Unternehmens-LLM-Gateway)
- **Dunkles/Helles Design** — Folgt der Systemeinstellung
- **Mehrsprachig** — Chinesisch, Englisch, Spanisch und mehr

[**Alle Funktionen entdecken →**](https://hello-halo.cc/docs/features/spaces.html)

---

## Roadmap

- [x] Claude Code SDK Agent Loop
- [x] Space- und Konversationsverwaltung
- [x] Artifact-Vorschau (Code, HTML, Bilder, Markdown)
- [x] Fernzugriff
- [x] AI Browser (CDP)
- [x] MCP Server Unterstützung
- [x] Skills-System
- [x] KI-Digitalmenschen und KI-Digitalmensch-Store
- [ ] Kompatibilität mit Drittanbieter-Ökosystem-Plugins
- [ ] Verbesserte Code-Bearbeitungserfahrung
- [ ] Visuelles Git + KI-gestützte Code-Reviews
- [ ] KI-gestützte Dateisuche
- [ ] Kostengünstige Digitalmensch-Aufzeichnung — KI-Workflows automatisch aufzeichnen und als wiederverwendbare Digitalmenschen abspielen

---

## Mitwirken

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **Übersetzungen** — `src/renderer/i18n/`
- **Fehlermeldungen** — [Issues](https://github.com/openkursar/hello-halo/issues)
- **Feature-Vorschläge** — [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **Code-Beiträge** — PRs sind willkommen

Siehe [CONTRIBUTING.md](../CONTRIBUTING.md) für Details.

---

## Community

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="Persönlicher WeChat QR-Code">
</p>
<p align="center">
  <em>Für Feedback oder Diskussionen, füge WeChat hinzu: go2halo mit dem Vermerk "Halo"</em>
</p>

---

## Die Geschichte von Halo

Im Oktober 2025, eine einfache Frustration: **Ich wollte Claude Code nutzen, aber ich steckte den ganzen Tag in Meetings.**

Während eines langweiligen Meetings dachte ich: *Was, wenn ich Claude Code auf meinem Heimcomputer von meinem Handy aus steuern könnte?*

Dann kam das zweite Problem — nicht-technische Kollegen wollten es auch nutzen, blieben aber bei der Installation hängen. *"Was ist npm?"*

Also baute ich Halo: eine visuelle Oberfläche, Ein-Klick-Installation, Fernzugriff. Die erste Version dauerte ein paar Stunden. Alles danach? **100% von Halo selbst gebaut.**

Jetzt glauben wir, dass der nächste Schritt die **KI-Arbeitsstation** ist: KI braucht niemanden mehr, der zuschaut, um die Arbeit zu erledigen. Du setzt die Ziele, KI-Digitalmenschen arbeiten autonom 7x24 voran. Code schreiben, Tests ausführen, Deployments überwachen, Berichte generieren — durchgehend laufend, wobei du nur an wichtigen Kontrollpunkten Entscheidungen triffst.

Das ist es, was Halo baut.

---

## Lizenz

MIT — [LICENSE](../LICENSE)

---

<div align="center">

## Mitwirkende

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**Gib diesem Repo einen Stern**, um mehr Menschen zu helfen, Halo zu entdecken.

</div>

---

## Partner & Sponsoren

Wenn Halo Ihr Projekt inspiriert hat oder Sie etwas darauf aufgebaut haben, würde uns eine Erwähnung sehr freuen.

### Unternehmenspartner

<!-- Add your company logo here — submit a PR or contact us at the link below -->

| Dein Unternehmen nutzt Halo? | [Lass es uns wissen](https://github.com/openkursar/hello-halo/issues/new?title=Add+our+company+as+partner) — wir würden dich gerne hier vorstellen. |
|:---:|:---:|

### Sponsoren

<a href="https://www.nnscholar.com/">
  <img src="https://www.nnscholar.com/favicon.ico" height="40" alt="NNScholar">
</a>

<p align="center">
  <a href="https://buy.polar.sh/polar_cl_x7bTGvMvt3rbUt6oE98z0zb2zFz1sT7dG37BA3foNsZ">Polar (International)</a> · <a href="https://ifdian.net/a/hello-halo">爱发电 (Alipay / WeChat)</a>
</p>

---

<div align="center">

[Zurück nach oben](#halo)

</div>
