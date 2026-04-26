<div align="center">

<img src="../resources/icon.png" alt="Halo Logo" width="120" height="120">

# Halo

### Desktop AI Agent. Code, automate, run 7x24.

Toda la potencia de Claude Code, sin necesidad de terminal.
Escribe código, controla el navegador, crea Humanos Digitales — tu IA, disponible las 24 horas.

[![GitHub Stars](https://img.shields.io/github/stars/openkursar/hello-halo?style=social)](https://github.com/openkursar/hello-halo/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#instalación)
[![Downloads](https://img.shields.io/github/downloads/openkursar/hello-halo/total.svg)](https://github.com/openkursar/hello-halo/releases)

[**Descargar**](#instalación) · [**Documentación**](#documentación) · [**Contribuir**](#contribuir)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **[Deutsch](./README.de.md)** | **[Français](./README.fr.md)** | **[日本語](./README.ja.md)**

</div>

<!-- TODO: Reemplazar con un GIF de 30 segundos que muestre: el usuario escribe una frase → el Agent genera código automáticamente → los archivos aparecen en el Artifact Rail → vista previa del resultado -->
<div align="center">

![Space Home](./assets/space_home.jpg)

</div>

---

## ¿Por qué elegir Halo?

Halo se construye sobre [Claude Code](https://github.com/anthropics/claude-code), ofreciendo capacidades completas de producto con más de 300.000 líneas de código, validado por decenas de miles de usuarios y ejecutándose de forma estable en entornos empresariales. Además de eso, Halo también logra:

| Lo que no puedes hacer en el terminal | Halo sí puede |
|:---:|:---:|
| Ver cada archivo generado por la IA | **Artifact Rail** previsualiza código, HTML e imágenes en tiempo real |
| Se detiene cuando dejas el ordenador | **Acceso remoto**, continúa en cualquier momento desde móvil / H5 / WeChat / cliente Android |
| Hay que iniciarlo manualmente cada vez | **Humanos Digitales** funcionan automáticamente 7x24 |
| Usarlo con compañeros no técnicos | **Descarga y usa**, configuración cero |
| Automatizar operaciones del navegador | **AI Browser** con navegador integrado, controlado directamente por la IA |

> Powered by [Claude Code](https://github.com/anthropics/claude-code) — 100% compatible con las capacidades de Agent, MCP y Skills de Claude Code.

---

## Tu IA, sin necesidad de supervisión

La mayoría de herramientas de IA requieren que estés frente a la pantalla, conversando turno a turno. Halo es diferente — puede trabajar solo, tú solo decides en los momentos clave.

### Humanos Digitales — Empleados IA autónomos 7x24

Crea un Humano Digital, asígnale una tarea y una frecuencia de ejecución, y funcionará de forma autónoma según lo programado:

- Envío diario de un resumen de noticias tecnológicas cada mañana
- Verificación cada hora del estado de los servicios en producción, con notificaciones en caso de anomalías
- Análisis periódico de la competencia con generación de informes comparativos
- Monitoreo de actualizaciones de dependencias y vulnerabilidades de seguridad en GitHub
- Seguimiento de menciones de palabras clave en redes sociales

Instala con un clic desde la **Tienda de Humanos Digitales**, o crea el tuyo propio con lenguaje natural.

> Piénsalo como la combinación de un cron job + AI Agent — pero solo necesitas hablar en lenguaje humano.

Los Humanos Digitales tienen exactamente las mismas capacidades de Agent que el modo de conversación — el mismo motor Claude, la misma cadena de herramientas MCP, el mismo AI Browser, solo que se activan automáticamente según un horario, sin necesidad de que estés frente al ordenador.

**WeChat es tu consola de control.** Los Humanos Digitales soportan comunicación bidireccional a través de WeChat personal / WeCom — no solo recibes notificaciones, puedes dar instrucciones directamente al Humano Digital desde WeChat, consultar el progreso y solicitar informes.

![AI Digital Human](./assets/ai-digital-human.png)

### Browser Skill — Automatización web estable y fiable con IA

La automatización de navegador con IA convencional deja que la IA descubra por sí misma cómo hacer clic y rellenar campos cada vez, lo que frecuentemente falla.

Browser Skill adopta un enfoque diferente: **las operaciones comunes de cada sitio web se escriben previamente como scripts reutilizables**. La IA solo necesita decidir "qué script ejecutar ahora"; el script ya se encarga de cómo operar el sitio.

Los scripts de Skill se ejecutan directamente en un entorno de navegador real a través del `browser_run` de Halo — con acceso al DOM de la página, cookies y APIs internas, como si operaras desde la consola de Chrome DevTools. Por ejemplo, aquí está el código principal de un Skill de lectura de notificaciones de Bilibili:

```js
// .claude/skills/bili-get-messages/index.js
async (params) => {
  // Llamada directa a la API interna de Bilibili — las cookies se envían automáticamente, sin autenticación adicional
  const resp = await fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web', {
    credentials: 'include'
  }).then(r => r.json())

  // Devuelve datos estructurados a la IA, que decide cómo responder
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

Cuando un Humano Digital lo invoca, solo necesita una línea: `browser_run({ file: "skills/bili-get-messages/index.js" })` — una vez obtenidos los datos, la IA decide por sí misma cuáles necesitan respuesta y cómo responder.

Por ejemplo, el flujo de trabajo de un Humano Digital de Zhihu:
1. La IA decide: es hora de revisar si hay nuevas invitaciones a responder
2. Llama al Skill `zhihu-creator-invited` → el script obtiene automáticamente la lista de invitaciones y devuelve datos estructurados
3. La IA determina: esta pregunta vale la pena responder, comienza a escribir
4. Llama al Skill `zhihu-publish-answer` → el script rellena automáticamente el editor y publica

La IA toma las decisiones, el Skill ejecuta las operaciones. Estable, repetible, sin fallos.

Actualmente existen Skills listos para Bilibili, Zhihu, WeChat, Xiaohongshu y otras plataformas, y la comunidad también puede contribuir con los suyos.

### Acceso Remoto — Tu móvil es el control remoto de tu IA

Al activar el acceso remoto, puedes controlar el Halo de tu escritorio desde el móvil / H5 / WeChat / cliente Android. En una reunión, en el trayecto al trabajo, o incluso desde una cama de hospital (historia real), consulta el progreso de la IA y da nuevas instrucciones en cualquier momento.

---

## Inicio Rápido

**Comienza a usar en 30 segundos:**

1. [Descarga e instala](#instalación), inicia Halo
2. Introduce tu API Key (se recomienda Anthropic)
3. Comienza a conversar — prueba `Crea una aplicación de tareas con React` o `Analiza la estructura de código de este proyecto`
4. Observa cómo aparecen los archivos en el Artifact Rail, haz clic para previsualizar y solicita modificaciones

> Modelo recomendado: Serie Claude Sonnet / Opus

---

## Instalación

### Descargar (Recomendado)

| Plataforma | Descargar | Requisitos |
|------|------|------|
| **macOS** (Apple Silicon) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **macOS** (Intel) | [.dmg](https://github.com/openkursar/hello-halo/releases/latest) | macOS 11+ |
| **Windows** | [.exe](https://github.com/openkursar/hello-halo/releases/latest) | Windows 10+ |
| **Linux** | [.AppImage](https://github.com/openkursar/hello-halo/releases/latest) | Ubuntu 20.04+ |
| **Android** | [.apk](https://github.com/openkursar/hello-halo/releases/latest) | Android 8+ |
| **iOS** | Compilar desde código fuente | iOS 15+ |

**Descarga, instala, ejecuta.** No necesitas Node.js, ni npm, ni terminal.

### Compilar desde código fuente

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run prepare
npm run dev
```

---

## Tienda de Humanos Digitales

<table>
<tr>
<td width="50%" valign="top">

### Para usuarios — Instalación instantánea

Abre la Tienda de Humanos Digitales, elige uno, configura unos pocos campos y empezará a funcionar automáticamente. No necesitas escribir código ni prompts.

![AI Store](./assets/shop.png)

</td>
<td width="50%" valign="top">

### Para desarrolladores — Construye y publica

Escribe un `spec.yaml` y envía un PR al [Digital Human Protocol (DHP)](https://github.com/openkursar/digital-human-protocol). Una vez fusionado, estará disponible de inmediato para todos los usuarios de Halo.

También puedes crear Browser Skills (scripts `.js`) para que los Humanos Digitales ejecuten operaciones precisas en plataformas específicas.

</td>
</tr>
</table>

---

## Capturas de pantalla

![Chat Intro](./assets/chat_intro.jpg)

![Chat Todo](./assets/chat_todo.jpg)

*Acceso remoto: controla Halo desde cualquier lugar*

![Remote Settings](./assets/remote_setting.jpg)

<p align="center">
  <img src="./assets/mobile_remote_access.jpg" width="45%" alt="Acceso remoto desde móvil">
  &nbsp;&nbsp;
  <img src="./assets/mobile_chat.jpg" width="45%" alt="Chat desde móvil">
</p>

*AI Browser*

https://github.com/user-attachments/assets/2d4d2f3e-d27c-44b0-8f1d-9059c8372003

---

## Arquitectura

```
┌──────────────────────────────────────────────────┐
│                   Halo Desktop                    │
│                                                   │
│   React UI  ◄─IPC─►  Main Process  ◄──►  Claude  │
│  (Renderer)          ┌───────────┐       Code SDK │
│                      │ Humanos   │      (Agent    │
│                      │ Digitales │       Loop)    │
│                      │ Scheduler │                │
│                      └───────────┘                │
│                           │                       │
│                     ~/.halo/ (local)              │
└──────────────────────────────────────────────────┘
```

- **100% local** — Los datos no salen de tu ordenador (excepto llamadas a la API)
- **Sin backend** — Cliente de escritorio puro, usa tu propia API Key
- **Agent Loop** — Ejecución de herramientas, no solo generación de texto

---

## Más capacidades

- **Sistema de Espacios (Spaces)** — Espacios de trabajo aislados, los proyectos no interfieren entre sí
- **Skills (Habilidades)** — Instala paquetes de habilidades para ampliar las capacidades del Agent
- **AI Browser** — Navegador CDP integrado, la IA controla páginas web directamente
- **Soporte multi-modelo** — Anthropic, OpenAI, DeepSeek, y cualquier API compatible con OpenAI
- **Tema oscuro/claro** — Sigue la configuración del sistema
- **Multiidioma** — Chino, inglés, español y más

---

## Hoja de ruta

- [x] Claude Code SDK Agent Loop
- [x] Gestión de Espacios y conversaciones
- [x] Vista previa de Artifacts (código, HTML, imágenes, Markdown)
- [x] Acceso remoto
- [x] AI Browser (CDP)
- [x] Soporte de servidores MCP
- [x] Sistema de Skills (Habilidades)
- [x] Humanos Digitales y Tienda de Humanos Digitales
- [ ] Compatibilidad con plugins de ecosistemas de terceros
- [ ] Mejora de la experiencia de edición de código
- [ ] Visualización Git + Code Review asistido por IA
- [ ] Búsqueda inteligente de archivos con IA

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
- **Reportar bugs** — [Issues](https://github.com/openkursar/hello-halo/issues)
- **Sugerencias de funciones** — [Discussions](https://github.com/openkursar/hello-halo/discussions)
- **Contribuciones de código** — Los PR son bienvenidos

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) para más detalles.

---

## Comunidad

- [GitHub Discussions](https://github.com/openkursar/hello-halo/discussions)
- [GitHub Issues](https://github.com/openkursar/hello-halo/issues)

<p align="center">
  <img src="https://github.com/user-attachments/assets/49f1040c-b858-4d43-841b-206310d3c33f" width="200" alt="Código QR del grupo de WeChat">
</p>
<p align="center">
  <em>Si el código QR ha expirado, agrega en WeChat: go2halo con la nota "Halo"</em>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/500aa749-50d9-4587-986d-338b1ed899f1" width="200" alt="Código QR de WeChat personal">
</p>

---

## La historia de Halo

En octubre de 2025, una simple frustración: **Quería usar Claude Code, pero estaba en reuniones todo el día.**

Durante una reunión aburrida, pensé: *¿Y si pudiera controlar el Claude Code de mi ordenador desde el móvil?*

Luego vino el segundo problema — mis compañeros no técnicos también querían usarlo, pero se quedaron atascados en la instalación. *"¿Qué es npm?"*

Así que creé Halo: interfaz visual, instalación con un clic, acceso remoto. La primera versión se hizo en unas pocas horas. Todas las funciones posteriores fueron **100% construidas por el propio Halo.**

Ahora, creemos que el siguiente paso es la **estación de trabajo IA**: la IA ya no necesita que alguien la supervise para trabajar. Tú defines los objetivos, y los Humanos Digitales avanzan de forma autónoma 7x24. Escriben código, ejecutan tests, monitorizan despliegues, generan informes — funcionando continuamente, y tú solo decides en los momentos clave.

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

**Dale una estrella a este repositorio** para ayudar a que más personas descubran Halo.

[![Star History Chart](https://api.star-history.com/svg?repos=openkursar/hello-halo&type=Date)](https://star-history.com/#openkursar/hello-halo&Date)

[⬆ Volver arriba](#halo)

</div>
