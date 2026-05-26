# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

DBMind is an AI-powered database management desktop app built with Electron + React + TypeScript. It supports MySQL and PostgreSQL, featuring a multi-tab SQL editor with syntax highlighting, schema browsing, cell-level data editing with batch-save, and a table structure designer.

## Development commands

```bash
npm run dev              # Vite dev server only (browser preview, no DB access)
npm run build:electron   # Compile electron/ TypeScript to dist-electron/
npm run electron:dev     # Full desktop app: builds electron, starts Vite, launches Electron
npm run typecheck        # Type-check all TypeScript (tsc --noEmit)
```

The Electron main process is at `electron/main.ts` and preload at `electron/preload.cts`. The Vite dev server runs at `127.0.0.1:5173`. In dev mode, Electron loads the Vite URL; in production it loads `dist/index.html`.

## Architecture

### Two TypeScript compilations

The codebase uses **two separate tsconfig files** because Electron main/preload run in Node.js while the renderer runs in a browser:

| Config | Target | Module | Includes |
|--------|--------|--------|----------|
| `tsconfig.json` | renderer (`src/`) | ESNext/Bundler | `src/**/*` |
| `tsconfig.electron.json` | main + preload + shared | NodeNext | `electron/`, `src/shared/` |

The `src/shared/` directory is compiled by **both** configs — it contains types and SQL utilities used by both the Electron main process and the React renderer. When importing from shared in `electron/`, use `.js` extension in the import path (e.g., `../src/shared/types.js`).

### Process boundary (IPC)

The Electron main process owns all database connections and file I/O. The renderer communicates exclusively via `ipcMain.handle` / `ipcRenderer.invoke` channels exposed through `contextBridge.exposeInMainWorld('dbmind', api)` in the preload script. The `DbmindApi` interface in `src/shared/types.ts` defines the full API contract.

Key IPC channels: `connections:*`, `db:query`, `db:schema`, `db:update-cell`, `db:update-cells-batch`, `db:table-design:*`, `history:*`, `settings:*`, `ai:*`.

When running in Vite dev mode (browser only), `window.dbmind` is undefined and the app falls back to `browserFallbackApi` (`src/renderer/browserApi.ts`) which returns mock data or throws.

### Renderer component structure

```
src/renderer/
  App.tsx                    # Main app shell: state, routing, compositing components
  main.tsx                   # Entry: mounts <App> + imports all CSS modules
  components/
    ai/AiPanel.tsx           # AI chat panel with @table mention support
    connection/              # ConnectionForm + ConnectionModal
    editor/SqlEditor.tsx     # Syntax-highlighted SQL editor with autocomplete
    modals/SqlConfirmModal.tsx
    navigation/LeftRail.tsx  # Left icon rail
    result/HistoryPanel.tsx  # Query history list
    schema/TableDesigner.tsx # Table structure designer modal
    settings/SettingsView.tsx
    workspace/TopBar.tsx, WorkTabStrip.tsx
  styles/                    # 16 modular CSS files loaded in dependency order
```

### Electron services

```
electron/
  main.ts                    # App lifecycle, IPC handlers, JSON file persistence
  preload.cts                # contextBridge API exposure
  services/
    dataEditor.ts            # Single-cell & batch UPDATE SQL builder + executor (with transactions)
    tableDesigner.ts         # Table design: read schema metadata, diff ALTER, apply DDL
    dbCommon.ts              # MySQL connection options factory, write guard
```

### Shared SQL utilities

`src/shared/sql/identifiers.ts` — `quoteMysqlIdentifier`, `mysqlTableRef` (used by both frontend and backend).
`src/shared/sqlTools.ts` — `validateSql` (DDL/destructive warnings), `buildSchemaPrompt` (AI context), `extractTableMentions`, `localSqlFromPrompt`.

### Data persistence

Connection configs, app settings, and query history are stored as JSON files in `app.getPath('userData')` (`connections.json`, `settings.json`, `query-history.json`). No embedded database — plain JSON read/write via `fs/promises`.

### Key types

All shared types live in `src/shared/types.ts`: `DbConnectionConfig`, `TableSchema`, `QueryResult`, `WorkTab`, `BatchUpdateCellRequest/Response`, `TableDesign`/`TableDesignChange`, `DbmindApi` (the full API interface).

## Style organization

CSS is split into 16 files in `src/renderer/styles/`, loaded in a specific order in `main.tsx`:
1. `tokens.css` — CSS custom properties (colors, spacing)
2. `reset.css` — box-sizing, body/html reset, spinner
3. `layout.css` — `.app-shell` grid, resize handles, media queries
4. `theme-light.css` — all `.theme-light` overrides (must load after base styles)
5. Remaining files in any order: `rail.css`, `sidebar.css`, `ai-panel.css`, `workspace.css`, `datatable.css`, `schema-card.css`, `composer.css`, `history.css`, `settings.css`, `modals.css`, `batch-edit.css`, `sql-editor.css`
