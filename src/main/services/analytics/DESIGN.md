# Analytics Module — Design

## Purpose

Single entry point for all telemetry in the main process. Accepts events from
the renderer (via IPC or HTTP), from internal subscribers (app lifecycle, run
lifecycle), and from startup snapshot, and fans them out to a pluggable set
of providers (GA, Baidu, self-hosted Telemetry).

Disabled in development (`is.dev`) and in open-source builds where no
provider credentials are injected.

## Directory Layout

```
src/main/services/analytics/
├── analytics.service.ts     # Singleton service: init, track, destroy, watermark
├── types.ts                 # AnalyticsEvent*, UserContext, AnalyticsConfig, AnalyticsProvider
├── index.ts                 # Public re-exports
├── snapshot.ts              # Startup snapshot + run replay (one-shot per launch)
├── providers/
│   ├── base.ts              # BaseProvider: timeout / retry / safeTrack / logging
│   ├── ga.ts                # Google Analytics 4 (Measurement Protocol)
│   ├── baidu.ts             # Baidu Tongji
│   └── telemetry.ts         # Self-hosted batched provider
└── subscribers/
    └── apps.subscriber.ts   # AppManager + Runtime lifecycle → analytics events
```

## Core Concepts

### Singleton service (`analytics.service.ts`)

- `analytics.init()` — called exactly once from `main/index.ts` after
  `app.whenReady()`. Loads config, builds `UserContext`, initializes every
  provider that has credentials.
- `analytics.track(name, properties?)` — fire-and-forget event entry point.
  Dropped silently (with a throttled warning) when init has not completed.
- `analytics.destroy()` — called from `cleanupExtendedServices`. Triggers
  provider teardown (Telemetry flushes its batching queue).
- `analytics.whenSettled(timeoutMs)` — returns a promise that resolves once
  `init()` has finished (success or skip). Used by consumers that start on
  the same tick as init (notably `snapshot.ts`) to avoid race-drop.
- `analytics.getSnapshotState() / setSnapshotState()` — persists the
  `(lastSnapshotRunId, lastSnapshotTs)` watermark pair to
  `config.analytics.*` for the run-replay module.

### UserContext + external ID

`UserContext` always carries an anonymous per-install UUID (`userId`). When
`product.json.identitySource` is configured, `track()` resolves an
externally-meaningful UID from the active AI source via a dot-path
(e.g. `user.uid`) and sets `UserContext.externalUserId`. Resolution is
cached by `(sourceId, path)` so switching the active source or editing the
product config invalidates the cache on the next `track()`.

### Providers

All providers implement `AnalyticsProvider { name, initialized, init,
track, destroy? }`. Providers are isolated via `Promise.allSettled` — a
failure in one cannot starve the others.

| Provider  | Transport       | Batching | Flush                      | Privacy filter |
|-----------|-----------------|----------|----------------------------|----------------|
| Baidu     | Image beacon    | none     | immediate                  | upstream only  |
| GA4       | Measurement API | none     | immediate                  | upstream only  |
| Telemetry | POST /v1/events | in-memory queue | debounce 5s + size 100 + destroy() | **double pass** |

The Telemetry provider applies two privacy passes:

1. **Per-event whitelist** (`EVENT_WHITELIST` in `telemetry.ts`) — only
   listed keys survive for known event names.
2. **Global blocklist** (`BLOCKED_KEYS`) — drops every
   content/token/secret/path key regardless of whitelist.

The blocklist always wins on conflict.

### Subscribers

`installAppsSubscribers(appManager, runtime)` wires the two domain services
to the analytics pipeline:

| Source event                 | Emitted analytics event |
|------------------------------|-------------------------|
| `AppManager.onAppInstalled`  | `app.installed`         |
| `AppManager.onAppUninstalled`| `app.uninstalled`       |
| `Runtime.onRunStarted`       | `app.run.started`       |
| `Runtime.onRunFinished` (ok) | `app.run.completed`     |
| `Runtime.onRunFinished` (err)| `app.run.failed`        |

All subscribers are `void analytics.track(...)` — never awaited, never
throw into the business path. Error details are reduced to a short
`errorCode` (first colon/space-delimited token, capped at 48 chars); the
full error message never leaves the main process.

### Startup snapshot (`snapshot.ts`)

Runs once per launch after both AppManager and Runtime are initialized
**and** after `analytics.whenSettled()` resolves. Emits:

1. `installed_apps.snapshot` — the current population of non-uninstalled
   automation apps (summaries only: appId, specId, type, version, status,
   installedAt).
2. `app.run.replay` — one event per `automation_runs` row whose
   `finishedAt > lastSnapshotTs` and whose status is terminal
   (`ok | error | skipped`). Bounded by `MAX_RUNS_PER_APP=200` and
   `MAX_REPLAY_EVENTS=2000`. On success the watermark advances to the
   latest finished run shipped.

## Transport surfaces

| Caller      | Channel                        | Allowed events                                                      |
|-------------|--------------------------------|---------------------------------------------------------------------|
| Renderer    | `ipcMain.on('analytics:report')` | session.start, session.end, page.view, message.sent, message.received |
| Capacitor / remote | `POST /api/analytics/report`   | same whitelist (enforced by the IPC/HTTP handler)                   |
| Main-native | `analytics.track(...)` direct  | full event catalogue                                                |

The IPC + HTTP handlers both validate the payload shape, enforce the
renderer-allowed event whitelist, and forward to `analytics.track()`. Event
names outside the whitelist are rejected at the boundary.

## Bootstrap & shutdown ordering

Startup (`main/index.ts` + `bootstrap/extended.ts`):

1. `app.whenReady()` → create window.
2. `ready-to-show` → `setImmediate(() => { initializeExtendedServices(); initAnalytics(); })`.
3. `initializeExtendedServices()` registers IPC (`registerAnalyticsHandlers`)
   synchronously, then kicks off `initPlatformAndApps()` async.
4. `initPlatformAndApps()` inits AppManager and Runtime, calls
   `installAppsSubscribers(...)`, and kicks off `runStartupSnapshot(...)`
   fire-and-forget.
5. `runStartupSnapshot()` awaits `analytics.whenSettled(10s)` before
   emitting, so it never loses data to the init race.

Shutdown (`cleanupExtendedServices`):

1. `shutdownAppRuntime()` — deactivates apps, any trailing
   `RunFinishedEvent`s are still delivered to subscribers which enqueue
   them into the telemetry batch.
2. `shutdownAppManager()`.
3. `analytics.destroy()` — telemetry provider flushes the queue with a
   bounded 3s budget, then all providers release.

## Config keys

`config.analytics`:

| Field                | Meaning                                                             |
|----------------------|---------------------------------------------------------------------|
| `userId`             | Anonymous per-install UUID, generated on first launch               |
| `lastVersion`        | Last launched app version (drives `app_install`/`app_update` events)|
| `lastSnapshotRunId`  | Watermark for `app.run.replay` — most recent replayed runId         |
| `lastSnapshotTs`     | Watermark for `app.run.replay` — most recent replayed finishedAt    |

Build-time constants (injected in `electron.vite.config.ts`, read from
`.env.local`):

| Constant                       | Provider  |
|--------------------------------|-----------|
| `__HALO_GA_MEASUREMENT_ID__`   | GA4       |
| `__HALO_GA_API_SECRET__`       | GA4       |
| `__HALO_BAIDU_SITE_ID__`       | Baidu     |
| `__HALO_TELEMETRY_ENDPOINT__`  | Telemetry |
| `__HALO_TELEMETRY_API_KEY__`   | Telemetry |

An empty credential disables the corresponding provider cleanly — its
`init()` sets `_initialized = false` and `track()` becomes a no-op.

## Extension points

- **Adding a provider**: implement `AnalyticsProvider`, register in
  `AnalyticsService.initProviders()`, add its build-time constants, add
  its config block to `PROVIDER_CONFIG`.
- **Adding a renderer event**: extend `RENDERER_ALLOWED_EVENTS` in
  `ipc/analytics.ts` and add a whitelist entry in
  `providers/telemetry.ts#EVENT_WHITELIST`. Update `useTelemetry` hook if
  the event is emitted by the renderer shell.
- **Adding a subscriber domain**: add a new file under `subscribers/`
  following the pattern of `apps.subscriber.ts` — return an unsubscribe
  function, isolate every handler with try/catch.
