<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Votre Station de Travail IA — Pour les Equipes et les Individus

Deploiement local. Automatisation 24h/24. Les Humains Numeriques IA travaillent pendant que vous prenez les decisions.

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#installation)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**Telecharger**](#installation) · [**Documentation**](#documentation) · [**Contribuer**](#contribuer)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **[Deutsch](./README.de.md)** | **Français** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: Replace with a 30-second GIF showing: user types a sentence -> Agent automatically writes code -> files appear in Artifact Rail -> preview the result -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## Pourquoi Halo ?

Halo est une station de travail IA propulsee par un Agent de pointe avec une architecture moteur modulaire — compatible avec [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex), et plus encore. Avec une couche produit complete de plus de 300 000 lignes de code, validee par des dizaines de milliers d'utilisateurs et fonctionnant de maniere stable en environnement d'entreprise, Halo offre :

| Ce que Halo offre |
|:---:|
| **Votre Partenaire IA Quotidien** — programmation, design produit, operations, redaction, recherche — votre compagnon de travail au quotidien |
| **100% Local, Zero Dependance Cloud** — les donnees ne quittent jamais votre machine, conforme aux exigences de conformite d'entreprise |
| **Humains Numeriques IA** — travailleurs IA fonctionnant de maniere autonome 7j/24, gerant la surveillance, les rapports et les operations de routine |
| **AI Browser** — navigateur integre directement controle par l'IA, automatise tout systeme base sur le web |
| **Controle Natif WeCom / WeChat** — gerez les agents IA depuis la messagerie d'entreprise, zero cout de formation |
| **Acces a Distance** — controlez depuis le telephone / H5 / WeChat / Android, les managers suivent la progression en deplacement |
| **Telecharger et c'est Parti** — zero configuration, pas de backend requis, le SI deploie en quelques minutes |

> 100% compatible avec les capacites Agent de Claude Code, MCP et Skills.

---

## Humains Numeriques IA — Votre Main-d'OEuvre IA Autonome

Le RPA traditionnel suit des scripts rigides et echoue des que quelque chose change. Halo adopte une approche differente : **l'IA prend les decisions, les Halo Browser Skills executent les operations.** Le resultat est une automatisation qui comprend le contexte, s'adapte aux changements et execute avec precision.

### Agents Autonomes Fonctionnant 7j/24

Creez un Humain Numerique IA, attribuez-lui une tache et une frequence d'execution, et il fonctionne de maniere autonome selon le planning. Pas d'ecran a surveiller, pas de scripts a superviser.

**Automatisation des Reseaux Sociaux et Plateformes de Contenu :**

- Reponse automatique aux commentaires et DMs sur Xiaohongshu, Bilibili, Zhihu
- Publication programmee de contenu sur Twitter / X, comptes officiels WeChat
- Surveillance des mentions de marque et de l'activite concurrentielle, generation de resumes quotidiens
- Suivi des tendances et redaction automatique de suggestions de contenu

**Automatisation Interne d'Entreprise :**

- Patrouille des systemes internes OA / CRM / ERP, signalement des tickets en retard et des anomalies
- Generation de rapports standup quotidiens a partir de l'activite Jira / GitLab / GitHub
- Surveillance des pipelines CI/CD, notification des echecs de build, creation automatique de tickets d'incident
- Execution de verifications de conformite planifiees sur les tableaux de bord internes
- Collecte de donnees interdepartementales et elaboration de resumes executifs hebdomadaires

Installez en un clic depuis le **Magasin d'Humains Numeriques IA**, deployez un **magasin prive** pour votre organisation, ou creez les votres en langage naturel.

> Pensez-y comme cron + RPA + AI Agent en un seul outil — sauf que vous decrivez simplement ce que vous voulez en langage naturel.

Les Humains Numeriques IA ont exactement les memes capacites Agent que le mode conversation — le meme moteur Claude, la chaine d'outils MCP et le AI Browser — ils se declenchent simplement automatiquement selon le planning sans que vous ayez besoin d'etre devant l'ordinateur.

**WeChat / WeCom est votre panneau de controle.** Les Humains Numeriques IA supportent le controle conversationnel bidirectionnel via WeChat personnel / WeCom (WeChat Entreprise) — pas seulement recevoir des notifications, vous pouvez donner des instructions, verifier la progression et demander des rapports directement dans votre messagerie d'entreprise.

![AI Digital Human](./assets/ai-digital-human.png)

### Halo Browser Skill — L'IA Decide, les Scripts Executent

C'est ce qui differencie Halo des "agents de navigateur IA" qui naviguent au hasard en cliquant n'importe ou.

Halo Browser Skill adopte l'approche RPA pour la fiabilite : **pre-ecriture de scripts reutilisables pour les operations courantes sur chaque plateforme**. L'IA decide uniquement *quoi* faire et *quand* — le script sait deja *comment*.

Les scripts s'executent directement dans un vrai navigateur via le `browser_run` de Halo — avec un acces complet au DOM de la page, aux cookies et aux APIs internes, exactement comme la console Chrome DevTools. Cela fonctionne aussi bien pour les plateformes publiques que pour les systemes d'entreprise prives.

**Exemple : Lecture des notifications Bilibili**

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

L'IA l'appelle avec : `browser_run({ file: ".claude/skills/bili-get-messages/index.js" })`

**Exemple : Workflow d'entreprise — un Humain Numerique pour les operations de contenu Xiaohongshu :**
1. L'IA decide : il est temps de verifier les nouveaux commentaires sur les publications du jour
2. Appelle le Skill `xhs-get-comments` → le script recupere la liste des commentaires via l'API de la plateforme
3. L'IA evalue : ces 5 commentaires necessitent des reponses, redige des reponses personnalisees
4. Appelle le Skill `xhs-reply-comment` → le script soumet chaque reponse

**Exemple : Interne d'entreprise — un Humain Numerique de surveillance DevOps :**
1. L'IA decide : il est temps de la verification horaire de l'infrastructure
2. Appelle le Skill `check-grafana-alerts` → le script lit le tableau de bord d'alertes via l'API interne
3. L'IA evalue : 2 alertes sont critiques, compose un resume d'incident
4. Appelle le Skill `create-jira-ticket` → le script cree un ticket P1 avec le contexte complet
5. Appelle le Skill `notify-oncall` → envoie l'alerte au groupe d'astreinte WeCom

**L'IA decide. Les Skills executent. Stable, repetable, auditable.**

Des Skills prets a l'emploi sont disponibles pour Xiaohongshu, Bilibili, Zhihu, Twitter / X, WeChat, et plus encore. Les equipes d'entreprise peuvent ecrire des Skills prives pour les systemes internes. La communaute peut contribuer et partager les siens.

### Acces a Distance — Gerez Votre Flotte IA Depuis N'importe Ou

Une fois l'Acces a Distance active, votre telephone / H5 / WeChat / client Android peut controler Halo sur votre bureau. Pendant les reunions, les trajets ou en deplacement — verifiez les resultats des Humains Numeriques, approuvez les decisions et emettez de nouvelles instructions sans etre a votre bureau.

---

## Demarrage Rapide

**Commencez en 30 secondes :**

1. [Telechargez et installez](#installation), lancez Halo
2. Entrez votre API Key (Anthropic recommande)
3. Commencez a discuter — essayez `Build a todo app with React` ou `Help me analyze the code structure of this project`
4. Regardez les fichiers apparaitre dans l'Artifact Rail, cliquez pour previsualiser, demandez des modifications

> Modeles recommandes : Series Claude Sonnet / Opus

---

## Installation

### Telechargement (Recommande)

| Plateforme | Telechargement | Prerequis |
|----------|----------|--------------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | Compiler depuis les sources | iOS 15+ |

**Telechargez, installez, lancez.** Pas besoin de Node.js, npm, ni de terminal. Le SI peut distribuer dans toute l'organisation sans dependances cote serveur.

### Compiler depuis les Sources

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## Magasin d'Humains Numeriques IA

<table>
<tr>
<td width="50%" valign="top">

### Pour les Utilisateurs — Installez et Utilisez Instantanement

Ouvrez le Magasin d'Humains Numeriques IA, choisissez-en un, remplissez quelques champs de configuration, et il commence a fonctionner automatiquement. Pas de programmation necessaire, pas de prompts a ecrire.

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### Pour les Developpeurs — Creez et Publiez

Ecrivez un `spec.yaml` et soumettez un PR au [AI Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol). Une fois fusionne, il devient immediatement disponible pour tous les utilisateurs Halo.

Vous pouvez egalement ecrire des Halo Browser Skills (scripts `.js`) pour que les Humains Numeriques IA executent precisement des operations sur des plateformes specifiques.

</td>
</tr>
</table>

---

## Captures d'Ecran

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*Acces a Distance : Controlez Halo depuis n'importe ou*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="Acces a Distance Mobile">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="Chat Mobile">
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

## Plus de Fonctionnalites

- **100% Local** — Vos donnees ne quittent jamais votre machine, conforme aux exigences de conformite d'entreprise
- **Pas de Backend Requis** — Client de bureau pur, deploiement sur chaque poste de travail sans infrastructure serveur
- **Agent Loop** — Execution d'outils, pas seulement generation de texte
- **Systeme de Spaces** — Espaces de travail isoles, les projets n'interferent pas entre eux
- **Skills** — Installez des packs de competences pour etendre les capacites de l'Agent
- **AI Browser** — Navigateur CDP integre, l'IA controle directement les pages web
- **Support Multi-Modele** — Anthropic, OpenAI, DeepSeek, et toute API compatible OpenAI (connectez-vous a votre passerelle LLM d'entreprise)
- **Themes Sombre/Clair** — Suit la preference du systeme
- **Multi-Langue** — Chinois, anglais, espagnol et plus

[**Decouvrir toutes les fonctionnalites →**](https://hello-halo.cc/docs/features/spaces.html)

---

## Feuille de Route

- [x] Claude Code SDK Agent Loop
- [x] Gestion des Spaces et Conversations
- [x] Apercu des Artifacts (Code, HTML, Images, Markdown)
- [x] Acces a Distance
- [x] AI Browser (CDP)
- [x] Support MCP Server
- [x] Systeme de Skills
- [x] Humains Numeriques IA et Magasin d'Humains Numeriques IA
- [ ] Compatibilite avec les Plugins d'Ecosysteme Tiers
- [ ] Experience d'Edition de Code Amelioree
- [ ] Git Visuel + Revue de Code Assistee par IA
- [ ] Recherche de Fichiers par IA
- [ ] Enregistrement d'Humains Numeriques a Faible Cout — enregistrement et rejeu automatiques des workflows IA en tant qu'Humains Numeriques reutilisables

---

## Contribuer

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **Traductions** — `src/renderer/i18n/`
- **Signalement de Bugs** — [Issues](https://github.com/openkursar/hello-halo/issues)
- **Suggestions de Fonctionnalites** — [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **Contributions de Code** — Les PRs sont les bienvenues

Consultez [CONTRIBUTING.md](../CONTRIBUTING.md) pour les details.

---

## Communaute

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="QR Code WeChat Personnel">
</p>
<p align="center">
  <em>Pour tout retour ou discussion, ajoutez WeChat : go2halo avec la note "Halo"</em>
</p>

---

## L'Histoire de Halo

En octobre 2025, une simple frustration : **Je voulais utiliser Claude Code, mais j'etais bloque en reunions toute la journee.**

Pendant une reunion ennuyeuse, j'ai pense : *Et si je pouvais controler Claude Code sur mon ordinateur personnel depuis mon telephone ?*

Puis est venu le deuxieme probleme — les collegues non-techniques voulaient aussi l'utiliser, mais restaient bloques a l'installation. *"C'est quoi npm ?"*

Alors j'ai construit Halo : une interface visuelle, installation en un clic, acces a distance. La premiere version a pris quelques heures. Tout le reste ? **100% construit par Halo lui-meme.**

Maintenant, nous croyons que la prochaine etape est la **Station de Travail IA** : l'IA n'a plus besoin de quelqu'un pour surveiller son travail. Vous fixez les objectifs, les Humains Numeriques IA avancent de maniere autonome 7j/24. Ecrire du code, executer des tests, surveiller les deploiements, generer des rapports — fonctionnant en continu, avec vous qui ne prenez des decisions qu'aux points de controle cles.

C'est ce que Halo construit.

---

## Licence

MIT — [LICENSE](../LICENSE)

---

<div align="center">

## Contributeurs

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**Mettez une etoile a ce depot** pour aider plus de gens a decouvrir Halo.

</div>

---

## Partenaires & Sponsors

Si Halo a inspiré votre projet ou si vous avez construit quelque chose dessus, une mention nous ferait très plaisir.

### Partenaires d'Entreprise

<!-- Add your company logo here — submit a PR or contact us at the link below -->

| Votre entreprise utilise Halo ? | [Faites-le nous savoir](https://github.com/openkursar/hello-halo/issues/new?title=Add+our+company+as+partner) — nous serions ravis de vous mettre en avant ici. |
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

[Retour en haut](#halo)

</div>
