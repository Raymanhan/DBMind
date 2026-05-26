<p align="center">
  <img src="icon.png" width="96" alt="DBMind" />
</p>

<h1 align="center">DBMind</h1>

<p align="center">
  <strong>AI 驱动的数据库管理桌面工具</strong><br/>
  <sub>AI-Powered Database Management Desktop App</sub>
</p>

<p align="center">
  <a href="#%E4%B8%8B%E8%BD%BD--download">下载 / Download</a> ·
  <a href="#%E5%8A%9F%E8%83%BD--features">功能 / Features</a> ·
  <a href="#%E6%8A%80%E6%9C%AF%E6%A0%88--tech-stack">技术栈 / Tech</a> ·
  <a href="#%E8%AE%B8%E5%8F%AF--license">许可 / License</a>
</p>

---

## 功能 / Features

|  | 中文 | English |
|--|------|---------|
| AI | 自然语言生成 SQL 与一键优化，支持 OpenAI / Ollama / 兼容接口，流式响应，多轮对话 | Natural-language SQL generation & optimization. Supports OpenAI, Ollama & compatible APIs. Streaming & multi-turn context |
| 编辑器 | Monaco Editor 内核，SQL 语法高亮、智能补全、格式化、右键执行选区 | Monaco-based SQL editor with syntax highlighting, IntelliSense, formatting, and selection execution |
| 数据库 | MySQL + PostgreSQL，多连接管理，Schema 树形浏览 | MySQL & PostgreSQL with multi-connection management and schema tree browser |
| 数据 | 行内编辑、批量修改、变更预览、CSV/JSON 导出 | Inline editing, batch modifications, change preview, CSV/JSON export |
| 设计器 | 可视化增删改列/索引/外键，DDL 预览后执行 | Visual schema designer with DDL preview for columns, indexes, and foreign keys |
| 国际化 | 简体中文、繁体中文、English、Русский、日本語、한국어、Français、Deutsch | 8 languages: zh-CN, zh-TW, en, ru, ja, ko, fr, de |
| 主题 | 深色 / 浅色 | Dark / Light themes |

## 下载 / Download

前往 [Releases](../../releases) 下载对应平台最新版本：

| 平台 Platform | 格式 Format |
|---------------|-------------|
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Windows | `.exe` (NSIS) |
| Linux | `.AppImage` |

> macOS 首次打开请**右键** → 「打开」绕过公证限制。
> On first launch, **right-click** the `.dmg` → "Open" to bypass notarization.

## 技术栈 / Tech Stack

| 层 Layer | 技术 Technology |
|-----------|----------------|
| 桌面 Desktop | Electron 42 |
| 前端 UI | React 19 + TypeScript |
| 构建 Build | Vite 7 |
| 编辑器 Editor | Monaco Editor |
| 数据库 Database | mysql2 / pg |
| AI | OpenAI / Ollama / 兼容接口 |
| 打包 Packaging | electron-builder |
| 国际化 i18n | i18next + react-i18next |

## 许可 / License

[查看 LICENSE](LICENSE)

DBMind 为专有软件，免费下载使用。未经授权不得修改、再分发或用于提供托管服务。

DBMind is proprietary software, free to download and use. Modification, redistribution, or use as a hosted service is prohibited without permission.

---

<p align="center">
  <sub>Built by DBMind Team</sub>
</p>
