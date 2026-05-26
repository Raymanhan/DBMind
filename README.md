<h1 align="center">DBMind</h1>

<p align="center">
  <strong>AI-powered database management desktop app</strong>
  <br />
  MySQL · PostgreSQL &ensp;|&ensp; Multi-tab SQL Editor &ensp;|&ensp; AI SQL Generation &ensp;|&ensp; Data Editor &ensp;|&ensp; Schema Designer
</p>

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#features">Features</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#license">License</a>
</p>

---

## Features

- **AI SQL Generation** — Describe your query in natural language, and DBMind generates SQL based on your table schemas. Supports OpenAI / Ollama / compatible APIs, streaming responses, and multi-turn conversation context.
- **AI SQL Optimization** — One-click performance analysis with optimization suggestions and index recommendations.
- **Multi-tab SQL Editor** — Powered by Monaco Editor with syntax highlighting, keyword completion, database/table/column IntelliSense, right-click selection execution, and SQL formatting.
- **Multi-database** — MySQL and PostgreSQL. Multi-connection management with cross-database search and filtering.
- **Schema Browser** — Tree view of table structures with column types, indexes, and foreign keys. Double-click to browse data.
- **Data Browsing & Editing** — Inline cell editing, batch modifications, and change preview with safe-update confirmation.
- **Schema Designer** — Visual add/drop/modify columns, indexes, and foreign keys with DDL preview before execution.
- **Query History** — Auto-recorded queries with one-click backfill into the editor.
- **Export** — CSV / JSON export with column sorting.
- **Themes** — Dark and light themes.

## Download

Go to [GitHub Releases](../../releases) to download the latest version for your platform:

| Platform | Package |
|----------|---------|
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Windows | `.exe` (NSIS installer) |
| Linux | `.AppImage` |

> **Note for macOS users**: Since DBMind is not notarized, right-click the `.dmg` and select "Open" on first launch.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 42 |
| UI | React 19 + TypeScript |
| Build | Vite 7 |
| Editor | Monaco Editor |
| Database | mysql2 / pg |
| AI | OpenAI / Ollama / compatible APIs |
| Packaging | electron-builder |

## License

[View LICENSE](LICENSE)

DBMind is proprietary software, free to download and use. Modification, redistribution, or use for hosted services is prohibited without explicit permission.

---

<p align="center">
  <sub>Built by DBMind Team</sub>
</p>
