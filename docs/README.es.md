<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Tu Estación de Trabajo con IA — Para Equipos e Individuos

Despliegue local. Automatización las 24 horas. Los Humanos Digitales con IA trabajan mientras tú tomas las decisiones.

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#instalación)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**Descargar**](#instalación) · [**Documentación**](#documentación) · [**Contribuir**](#contribuir)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **Español** | **[Deutsch](./README.de.md)** | **[Français](./README.fr.md)** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: Replace with a 30-second GIF showing: user types a sentence -> Agent automatically writes code -> files appear in Artifact Rail -> preview the result -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## ¿Por qué Halo?

Halo es una estación de trabajo con IA impulsada por un Agent de vanguardia con una arquitectura de motor conectable — compatible con [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex) y más. Con una capa de producto completa de más de 300,000 líneas de código, validada por decenas de miles de usuarios y funcionando de forma estable en entornos empresariales, Halo ofrece:

| Lo que Halo ofrece |
|:---:|
| **Tu Compañero Diario de IA** — programación, diseño de producto, operaciones, redacción, investigación — tu compañero de trabajo diario |
| **100% Local, Cero Dependencia de la Nube** — los datos nunca salen de tu máquina, cumple los requisitos de conformidad empresarial |
| **Humanos Digitales con IA** — trabajadores de IA que operan de forma autónoma 7x24, gestionando monitoreo, informes y operaciones rutinarias |
| **AI Browser** — navegador integrado controlado directamente por la IA, automatiza cualquier sistema basado en web |
| **Control Nativo de WeCom / WeChat** — gestiona agentes de IA desde el IM empresarial, sin coste de formación |
| **Acceso Remoto** — controla desde teléfono / H5 / WeChat / Android, los gerentes revisan el progreso en movimiento |
| **Descargar y Listo** — sin configuración, sin backend necesario, TI lo despliega en minutos |

> 100% compatible con las capacidades de Agent de Claude Code, MCP y Skills.

---

## Humanos Digitales con IA — Tu Fuerza de Trabajo Autónoma

El RPA tradicional sigue scripts rígidos y falla cuando algo cambia. Halo adopta un enfoque diferente: **la IA toma las decisiones, las Halo Browser Skills ejecutan las operaciones.** El resultado es una automatización que entiende el contexto, se adapta a los cambios y ejecuta con precisión.

### Agentes Autónomos Funcionando 7x24

Crea un Humano Digital con IA, asígnale una tarea y una frecuencia de ejecución, y funciona de forma autónoma según el horario. Sin pantalla que vigilar, sin scripts que supervisar.

**Automatización de Redes Sociales y Plataformas de Contenido:**

- Respuesta automática a comentarios y mensajes directos en Xiaohongshu, Bilibili, Zhihu
- Publicación programada de contenido en Twitter / X, cuentas oficiales de WeChat
- Monitoreo de menciones de marca y actividad de la competencia, generación de resúmenes diarios
- Seguimiento de tendencias y redacción automática de sugerencias de contenido

**Automatización Empresarial Interna:**

- Patrullaje de sistemas internos OA / CRM / ERP, señalización de tickets vencidos y anomalías
- Generación de informes diarios de standup a partir de la actividad en Jira / GitLab / GitHub
- Monitoreo de pipelines CI/CD, notificación de fallos de compilación, creación automática de tickets de incidentes
- Ejecución de verificaciones de conformidad programadas en dashboards internos
- Recopilación de datos interdepartamentales y elaboración de resúmenes ejecutivos semanales

Instala con un clic desde la **Tienda de Humanos Digitales con IA**, despliega una **tienda privada** para tu organización, o crea los tuyos propios usando lenguaje natural.

> Piensa en ello como cron + RPA + AI Agent en uno — excepto que simplemente describes lo que quieres en lenguaje natural.

Los Humanos Digitales con IA tienen exactamente las mismas capacidades de Agent que el modo de conversación — el mismo motor Claude, la cadena de herramientas MCP y el AI Browser — simplemente se activan automáticamente según el horario sin necesidad de que estés frente al ordenador.

**WeChat / WeCom es tu panel de control.** Los Humanos Digitales con IA soportan control conversacional bidireccional a través de WeChat personal / WeCom (WeChat Empresarial) — no solo recibes notificaciones, puedes dar instrucciones, verificar el progreso y solicitar informes directamente en tu IM empresarial.

![AI Digital Human](./assets/ai-digital-human.png)

### Halo Browser Skill — La IA Decide, los Scripts Ejecutan

Esto es lo que diferencia a Halo de los "agentes de navegador con IA" que navegan sin rumbo haciendo clics aleatorios.

Halo Browser Skill adopta el enfoque de RPA para la fiabilidad: **pre-escribe scripts reutilizables para operaciones comunes en cada plataforma**. La IA solo decide *qué* hacer y *cuándo* — el script ya sabe *cómo*.

Los scripts se ejecutan directamente en un navegador real a través de `browser_run` de Halo — con acceso completo al DOM de la página, cookies y APIs internas, igual que la consola de Chrome DevTools. Esto funciona tanto para plataformas públicas como para sistemas empresariales privados.

**Ejemplo: Lectura de notificaciones de Bilibili**

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

La IA lo invoca con: `browser_run({ file: ".claude/skills/bili-get-messages/index.js" })`

**Ejemplo: Flujo de trabajo empresarial — un Humano Digital para operaciones de contenido en Xiaohongshu:**
1. La IA decide: es hora de revisar nuevos comentarios en las publicaciones de hoy
2. Llama al Skill `xhs-get-comments` → el script obtiene la lista de comentarios a través de la API de la plataforma
3. La IA juzga: estos 5 comentarios necesitan respuesta, redacta respuestas personalizadas
4. Llama al Skill `xhs-reply-comment` → el script envía cada respuesta

**Ejemplo: Interno empresarial — un Humano Digital de monitoreo DevOps:**
1. La IA decide: es hora de la verificación horaria de infraestructura
2. Llama al Skill `check-grafana-alerts` → el script lee el dashboard de alertas a través de la API interna
3. La IA juzga: 2 alertas son críticas, compone un resumen del incidente
4. Llama al Skill `create-jira-ticket` → el script crea un ticket P1 con contexto completo
5. Llama al Skill `notify-oncall` → envía la alerta al grupo de guardia en WeCom

**La IA decide. Los Skills ejecutan. Estable, repetible, auditable.**

Los Skills listos para usar están disponibles para Xiaohongshu, Bilibili, Zhihu, Twitter / X, WeChat y más. Los equipos empresariales pueden escribir Skills privados para sistemas internos. La comunidad puede contribuir y compartir los suyos propios.

### Acceso Remoto — Gestiona tu Flota de IA Desde Cualquier Lugar

Una vez habilitado el Acceso Remoto, tu teléfono / H5 / WeChat / cliente Android puede controlar Halo en tu escritorio. Durante reuniones, desplazamientos o en ruta — revisa los resultados de los Humanos Digitales, aprueba decisiones y emite nuevas instrucciones sin estar en tu escritorio.

---

## Inicio Rápido

**Empieza en 30 segundos:**

1. [Descarga e instala](#instalación), inicia Halo
2. Introduce tu API Key (Anthropic recomendado)
3. Comienza a chatear — prueba `Build a todo app with React` o `Help me analyze the code structure of this project`
4. Observa cómo aparecen los archivos en el Artifact Rail, haz clic para previsualizar, solicita cambios

> Modelos recomendados: Series Claude Sonnet / Opus

---

## Instalación

### Descarga (Recomendado)

| Plataforma | Descarga | Requisitos |
|----------|----------|--------------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | Compilar desde el código fuente | iOS 15+ |

**Descarga, instala, ejecuta.** No necesitas Node.js, npm, ni terminal. TI puede distribuirlo en toda la organización sin dependencias del lado del servidor.

### Compilar desde el Código Fuente

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## Tienda de Humanos Digitales con IA

<table>
<tr>
<td width="50%" valign="top">

### Para Usuarios — Instala y Usa al Instante

Abre la Tienda de Humanos Digitales con IA, elige uno, completa algunos campos de configuración y comienza a funcionar automáticamente. Sin necesidad de programar, sin prompts que escribir.

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### Para Desarrolladores — Crea y Publica

Escribe un `spec.yaml` y envía un PR al [AI Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol). Una vez fusionado, estará disponible inmediatamente para todos los usuarios de Halo.

También puedes escribir Halo Browser Skills (scripts `.js`) para que los Humanos Digitales con IA ejecuten operaciones con precisión en plataformas específicas.

</td>
</tr>
</table>

---

## Capturas de Pantalla

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*Acceso Remoto: Controla Halo desde cualquier lugar*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="Acceso Remoto Móvil">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="Chat Móvil">
</p>

*AI Browser*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## Arquitectura

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

## Más Funcionalidades

- **100% Local** — Tus datos nunca salen de tu máquina, cumple los requisitos de conformidad empresarial
- **Sin Backend Necesario** — Cliente de escritorio puro, despliega en cada estación de trabajo sin infraestructura de servidor
- **Agent Loop** — Ejecución de herramientas, no solo generación de texto
- **Sistema de Spaces** — Espacios de trabajo aislados, los proyectos no interfieren entre sí
- **Skills** — Instala paquetes de habilidades para ampliar las capacidades del Agent
- **AI Browser** — Navegador CDP integrado, la IA controla directamente las páginas web
- **Soporte Multi-Modelo** — Anthropic, OpenAI, DeepSeek y cualquier API compatible con OpenAI (conéctate a tu gateway LLM empresarial)
- **Temas Oscuro/Claro** — Sigue la preferencia del sistema
- **Multi-Idioma** — Chino, inglés, español y más

[**Explorar todas las funcionalidades →**](https://hello-halo.cc/docs/features/spaces.html)

---

## Hoja de Ruta

- [x] Claude Code SDK Agent Loop
- [x] Gestión de Spaces y Conversaciones
- [x] Vista Previa de Artifacts (Código, HTML, Imágenes, Markdown)
- [x] Acceso Remoto
- [x] AI Browser (CDP)
- [x] Soporte de MCP Server
- [x] Sistema de Skills
- [x] Humanos Digitales con IA y Tienda de Humanos Digitales con IA
- [ ] Compatibilidad con Plugins de Ecosistema de Terceros
- [ ] Experiencia de Edición de Código Mejorada
- [ ] Git Visual + Revisión de Código Asistida por IA
- [ ] Búsqueda de Archivos con IA
- [ ] Grabación de Humanos Digitales de Bajo Coste — graba y reproduce automáticamente flujos de trabajo de IA como Humanos Digitales reutilizables

---

## Contribuir

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

- **Traducciones** — `src/renderer/i18n/`
- **Reportar Errores** — [Issues](https://github.com/openkursar/hello-halo/issues)
- **Sugerencias de Funcionalidades** — [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **Contribuciones de Código** — Los PRs son bienvenidos

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) para más detalles.

---

## Comunidad

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="Código QR de WeChat Personal">
</p>
<p align="center">
  <em>Para cualquier comentario o discusión, agrega WeChat: go2halo con la nota "Halo"</em>
</p>

---

## La Historia de Halo

En octubre de 2025, una simple frustración: **Quería usar Claude Code, pero estaba atrapado en reuniones todo el día.**

Durante una reunión aburrida, pensé: *¿Y si pudiera controlar Claude Code en mi ordenador de casa desde mi teléfono?*

Luego vino el segundo problema — los compañeros no técnicos también querían usarlo, pero se quedaban atascados en la instalación. *"¿Qué es npm?"*

Así que construí Halo: una interfaz visual, instalación con un clic, acceso remoto. La primera versión tomó unas pocas horas. ¿Todo lo demás? **100% construido por el propio Halo.**

Ahora, creemos que el siguiente paso es la **Estación de Trabajo con IA**: la IA ya no necesita a alguien observando para hacer su trabajo. Tú estableces los objetivos, los Humanos Digitales con IA avanzan de forma autónoma 7x24. Escribiendo código, ejecutando pruebas, monitoreando despliegues, generando informes — funcionando continuamente, contigo solo tomando decisiones en los puntos de control clave.

Eso es lo que Halo está construyendo.

---

## Licencia

MIT — [LICENSE](../LICENSE)

---

<div align="center">

## Contribuidores

<a href="https://github.com/openkursar/hello-halo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openkursar/hello-halo" />
</a>

**Dale una estrella a este repositorio** para ayudar a más personas a descubrir Halo.

</div>

---

## Socios y Patrocinadores

Si Halo inspiró tu proyecto o construiste algo basado en él, una mención significaría mucho.

### Socios Empresariales

<!-- Add your company logo here — submit a PR or contact us at the link below -->

| ¿Tu empresa usa Halo? | [Cuéntanos](https://github.com/openkursar/hello-halo/issues/new?title=Add+our+company+as+partner) — nos encantaría destacarte aquí. |
|:---:|:---:|

### Patrocinadores

<a href="https://www.nnscholar.com/">
  <img src="https://www.nnscholar.com/favicon.ico" height="40" alt="NNScholar">
</a>

<p align="center">
  <a href="https://buy.polar.sh/polar_cl_x7bTGvMvt3rbUt6oE98z0zb2zFz1sT7dG37BA3foNsZ">Polar (International)</a> · <a href="https://ifdian.net/a/hello-halo">爱发电 (Alipay / WeChat)</a>
</p>

---

<div align="center">

[Volver arriba](#halo)

</div>
