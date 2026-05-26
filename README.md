<p align="center">
  <img src="build/icon.png" width="120" alt="DBMind logo" />
</p>

<h1 align="center">DBMind</h1>

<p align="center">
  <strong>AI-powered database management desktop app</strong>
  <br />
  MySQL · PostgreSQL · Monaco SQL Editor · AI Assistant · Data Editing · Table Designer
</p>

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#latest-release">Latest Release</a> ·
  <a href="#features">Features</a> ·
  <a href="#development">Development</a> ·
  <a href="#license">License</a>
</p>

---

## Download

Download the latest installer from [GitHub Releases](../../releases).

| Platform | Package |
|----------|---------|
| macOS Apple Silicon | `DBMind-<version>-mac-arm64.dmg` |
| macOS Intel | `DBMind-<version>-mac-x64.dmg` |
| Windows | `DBMind Setup <version>.exe` |
| Linux | `DBMind-<version>.AppImage` |

## Latest Release

### v0.2.3

- Global internationalization now applies across the main workspace, settings, sidebar, connection modal, AI assistant, conversation history, result views, batch editing, cell editing, SQL confirmation modal, table designer, and SQL editor menus.
- AI SQL generation and optimization now receive the selected UI language as part of the prompt, so explanations and optimization suggestions follow the user's language.
- Default AI conversations now refresh their title and welcome message when the language changes.
- Settings layout is fixed for the language selector and narrow windows.
- Browser preview messages now follow the selected language for key flows.

## Features

- **AI SQL Assistant**: generate SQL from natural language with schema-aware context, table mentions, OpenAI-compatible providers, Ollama, and conversation history.
- **AI SQL Optimization**: analyze existing SQL and return optimized SQL with performance, readability, safety, and index suggestions.
- **Global Internationalization**: switch between Simplified Chinese, Traditional Chinese, English, Russian, Japanese, Korean, French, and German.
- **Multi-tab SQL Workspace**: Monaco-powered SQL editor with syntax highlighting, completions, context actions, formatting, and selection execution.
- **MySQL / PostgreSQL Connections**: manage multiple connections, browse schemas, search databases, and open tables quickly.
- **Schema Browser**: inspect tables, columns, indexes, and foreign keys from a compact tree.
- **Data Browsing and Editing**: edit cells inline, batch changes, preview write SQL, and safely confirm updates.
- **Table Designer**: visually add, modify, or drop columns, indexes, and foreign keys, then preview generated DDL before applying.
- **Query History**: automatically records recent queries and lets you send them back to the editor.
- **Export Results**: export query results as CSV or JSON.
- **Themes**: switch between light and dark desktop themes.

## Development

```bash
# Install dependencies
npm install

# Browser preview with mock data
npm run dev

# Full Electron desktop app
npm run electron:dev

# Type check
npm run typecheck

# Production build
npm run build
```

The browser preview uses mock data and does not connect to local databases. Use `npm run electron:dev` for the full desktop runtime.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 42 |
| Frontend | React 19 + TypeScript |
| Build | Vite 7 |
| SQL Editor | Monaco Editor |
| Database Drivers | mysql2 / pg |
| AI Providers | OpenAI / Ollama / OpenAI-compatible APIs |
| Packaging | electron-builder |

## License

[See LICENSE](LICENSE)

DBMind is proprietary software provided for free download and use. Modification, redistribution, or hosted-service use is not permitted without authorization.
