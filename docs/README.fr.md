<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Desktop AI Agent. Code, automate, run 7x24.

Toute la puissance de Claude Code, sans terminal.
Ecrire du code, piloter un navigateur, creer des Humains Numeriques -- votre IA, disponible 24h/24.

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#installation)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**Télécharger**](#installation) · [**Documentation**](#documentation) · [**Contribuer**](#contribuer)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **[Deutsch](./README.de.md)** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: Remplacer par un GIF de 30 secondes montrant : l'utilisateur saisit une phrase -> l'Agent ecrit du code automatiquement -> le fichier apparait dans l'Artifact Rail -> apercu du resultat -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## Pourquoi choisir Halo ?

Halo est construit sur [Claude Code](https://github.com/anthropics/claude-code), avec un ensemble complet de fonctionnalites produit, plus de 300 000 lignes de code cumulees, valide par des dizaines de milliers d'utilisateurs et fonctionnant de maniere stable en environnement professionnel. En plus de cela, Halo offre egalement :

| Impossible dans le terminal | Halo le peut |
|:---:|:---:|
| Voir chaque fichier genere par l'IA | **Artifact Rail** pour previsualiser en temps reel le code, HTML, images |
| Ca s'arrete quand vous quittez l'ordinateur | **Acces distant**, continuez a tout moment via mobile / H5 / WeChat / client Android |
| Il faut relancer manuellement a chaque fois | **Humains Numeriques** fonctionnant automatiquement 7x24 |
| Difficile a utiliser pour les collegues non techniques | **Telecharger et utiliser**, zero configuration |
| Automatiser les operations du navigateur | **AI Browser** avec navigateur integre, controle direct par l'IA |

> Powered by [Claude Code](https://github.com/anthropics/claude-code) -- 100% compatible avec les capacites Agent, MCP et Skills de Claude Code.

---

## Votre IA, sans avoir besoin de la surveiller

La plupart des outils IA necessitent que vous restiez devant l'ecran, a dialoguer tour apres tour. Halo est different -- il peut travailler de maniere autonome, vous n'intervenez qu'aux moments cles pour prendre des decisions.

### Humains Numeriques -- Des collaborateurs IA autonomes 7x24

Creez un Humain Numerique, attribuez-lui une tache et une frequence d'execution, et il fonctionnera de maniere autonome selon le planning :

- Envoyer un resume des actualites tech chaque matin
- Verifier l'etat des services en ligne toutes les heures, et vous notifier en cas d'anomalie
- Executer des analyses concurrentielles a intervalles reguliers et generer des rapports comparatifs
- Surveiller les mises a jour des dependances GitHub et les vulnerabilites de securite
- Suivre les mentions de mots-cles sur les reseaux sociaux

Installez-les en un clic depuis la **Boutique d'Humains Numeriques**, ou creez les votres en langage naturel.

> Imaginez-le comme la combinaison d'un cron job et d'un Agent IA -- mais il suffit de parler normalement.

Les Humains Numeriques disposent exactement des memes capacites Agent que le mode conversation -- le meme moteur Claude, la meme chaine d'outils MCP, le meme AI Browser, sauf qu'ils se declenchent automatiquement selon un planning, sans que vous ayez besoin d'etre devant votre ordinateur.

**WeChat est votre console de controle.** Les Humains Numeriques supportent le controle bidirectionnel par dialogue via WeChat personnel / WeCom -- pas seulement pour recevoir des notifications, vous pouvez directement donner des instructions a l'Humain Numerique dans WeChat, verifier la progression et demander des rapports.

![AI Digital Human](./assets/ai-digital-human.png)

### Browser Skill -- Rendre l'automatisation IA des sites web stable et fiable

L'automatisation classique du navigateur par IA laisse l'IA tattonner a chaque fois pour trouver ou cliquer et quoi remplir, ce qui echoue souvent.

Browser Skill adopte une approche differente : **les operations courantes de chaque site web sont pre-ecrites sous forme de scripts reutilisables**. L'IA n'a qu'a decider "quel script appeler maintenant", les details d'interaction avec le site sont deja geres par le script.

Les scripts Skill s'executent directement dans un environnement de navigateur reel via `browser_run` de Halo -- avec acces au DOM de la page, aux cookies et aux API internes, comme si vous opériez depuis la console Chrome DevTools. Par exemple, voici le code principal d'un Skill de lecture des notifications Bilibili :

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  // Appel direct a l'API interne de Bilibili -- les cookies sont automatiquement inclus, pas d'authentification supplementaire
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'
  }).then(r => r.json())

  // Retourne des donnees structurees a l'IA, qui decide comment repondre
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

L'Humain Numerique n'a qu'a appeler : `browser_run({ file: "skills/bili-get-messages/index.js" })` -- une fois les donnees obtenues, l'IA decide par elle-meme lesquelles necessite une reponse et comment repondre.

Par exemple, le workflow d'un Humain Numerique Zhihu :
1. L'IA decide : il est temps de verifier s'il y a de nouvelles invitations a repondre
2. Appelle le Skill `zhihu-creator-invited` -> le script recupere automatiquement la liste des invitations et retourne des donnees structurees
3. L'IA juge : cette question merite une reponse, et commence a rediger
4. Appelle le Skill `zhihu-publish-answer` -> le script remplit automatiquement l'editeur et publie

L'IA prend les decisions, le Skill execute les operations. Stable, reproductible, sans erreur.

Des Skills prets a l'emploi sont deja disponibles pour Bilibili, Zhihu, WeChat, Xiaohongshu et d'autres plateformes, et la communaute peut contribuer les siens.

### Acces distant -- Votre telephone est votre telecommande IA

Une fois l'acces distant active, vous pouvez controler Halo sur votre bureau depuis un mobile / H5 / WeChat / client Android. En reunion, en deplacement, ou meme depuis un lit d'hopital (histoire vraie), consultez a tout moment la progression de l'IA et donnez de nouvelles instructions.

---

## Demarrage rapide

**Pret en 30 secondes :**

1. [Telecharger et installer](#installation), lancer Halo
2. Saisir votre cle API (Anthropic recommande)
3. Commencer a dialoguer -- essayez `Cree une application de taches avec React` ou `Analyse la structure du code de ce projet`
4. Regardez les fichiers apparaitre dans l'Artifact Rail, cliquez pour previsualiser, demandez des modifications

> Modeles recommandes : serie Claude Sonnet / Opus

---

## Installation

### Telecharger (recommande)

| Plateforme | Telecharger | Configuration requise |
|------|------|------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | Compiler depuis les sources | iOS 15+ |

**Telecharger, installer, lancer.** Pas besoin de Node.js, pas besoin de npm, pas besoin de terminal.

### Compiler depuis les sources

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## Boutique d'Humains Numeriques

<table>
<tr>
<td width="50%" valign="top">

### Pour les utilisateurs -- Installation instantanee

Ouvrez la Boutique d'Humains Numeriques, choisissez-en un, remplissez quelques champs de configuration, et il commence a fonctionner automatiquement. Pas besoin d'ecrire du code, pas besoin d'ecrire de prompt.

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### Pour les developpeurs -- Construire et publier

Ecrivez un `spec.yaml` et soumettez une PR au [Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol). Apres fusion, tous les utilisateurs Halo y ont immediatement acces.

Vous pouvez aussi ecrire des Browser Skills (scripts `.js`) pour vos Humains Numeriques, leur permettant d'executer des operations precises sur des plateformes specifiques.

</td>
</tr>
</table>

---

## Captures d'ecran

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*Acces distant : controlez Halo depuis n'importe ou*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="Acces distant mobile">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="Chat mobile">
</p>

*AI Browser*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## Architecture

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
│                     ~/.halo/ (local)              │
└──────────────────────────────────────────────────┘
```

- **100% local** -- Les donnees ne quittent jamais votre ordinateur (sauf pour les appels API)
- **Aucun backend necessaire** -- Client de bureau pur, utilisez votre propre cle API
- **Agent Loop** -- Execution d'outils, pas seulement generation de texte

---

## Autres fonctionnalites

- **Systeme d'Espaces (Spaces)** -- Espaces de travail isoles, les projets n'interferent pas entre eux
- **Skills (competences)** -- Installez des packs de competences pour etendre les capacites de l'Agent
- **AI Browser** -- Navigateur CDP integre, l'IA controle directement les pages web
- **Support multi-modeles** -- Anthropic, OpenAI, DeepSeek, et toute API compatible OpenAI
- **Theme sombre/clair** -- Suit le systeme
- **Multilingue** -- Chinois, anglais, espagnol, etc.

---

## Feuille de route

- [x] Claude Code SDK Agent Loop
- [x] Gestion des Espaces et des conversations
- [x] Apercu des artefacts (code, HTML, images, Markdown)
- [x] Acces distant
- [x] AI Browser (CDP)
- [x] Support MCP Server
- [x] Systeme de Skills
- [x] Humains Numeriques et Boutique d'Humains Numeriques
- [ ] Compatibilite avec les plugins d'ecosystemes tiers
- [ ] Experience d'edition de code amelioree
- [ ] Git visuel + revue de code assistee par IA
- [ ] Recherche de fichiers intelligente par IA

---

## Contribuer

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **Traductions** -- `src/renderer/i18n/`
- **Rapports de bugs** -- [Issues](https://github.com/openkursar/hello-halo/issues)
- **Suggestions de fonctionnalites** -- [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **Contributions de code** -- Les PR sont les bienvenues

Voir [CONTRIBUTING.md](../CONTRIBUTING.md) pour plus de details.

---

## Communaute

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/49f1040c-b858-4d43-841b-206310d3c33f" width="200" alt="QR code du groupe WeChat">
</p>
<p align="center">
  <em>Si le QR code a expire, ajoutez le WeChat : go2halo avec la mention "Halo"</em>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="QR code WeChat personnel">
</p>

---

## L'histoire de Halo

En octobre 2025, une simple frustration : **Je voulais utiliser Claude Code, mais j'etais en reunion toute la journee.**

Pendant une reunion ennuyeuse, j'ai pense : *Et si je pouvais controler Claude Code sur mon ordinateur a la maison depuis mon telephone ?*

Puis est venue une deuxieme question -- des collegues non techniques voulaient aussi l'utiliser, mais ils etaient bloques a l'installation. *"C'est quoi npm ?"*

Alors j'ai cree Halo : une interface visuelle, une installation en un clic, un acces distant. La premiere version a pris quelques heures. Toutes les fonctionnalites suivantes ont ete **100% construites par Halo lui-meme.**

Aujourd'hui, nous croyons que la prochaine etape est la **station de travail IA** : l'IA n'a plus besoin d'etre surveillee pour travailler. Vous fixez les objectifs, les Humains Numeriques avancent de maniere autonome 7x24. Ecrire du code, lancer des tests, surveiller les deployments, generer des rapports -- fonctionnement continu, vous ne decidez qu'aux moments cles.

C'est ce que Halo est en train de construire.

---

## Licence

MIT -- [LICENSE](../LICENSE)

---

<div align="center">

## Contributeurs

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**Mettez une etoile a ce depot** pour aider d'autres personnes a decouvrir Halo.

[![Star History Chart](https://api.star-history.com/svg?repos=openkursar/hello-halo&type=Date)](https://star-history.com/#openkursar/hello-halo&Date)

[⬆ Retour en haut](#halo)

</div>
