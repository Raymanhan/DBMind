# DBMind 设计文档

> **AI Native SQL Workspace** — 基于 Tauri v2 + Rust + React 构建的桌面端智能 SQL 工作空间  
> 版本：v0.2.9

---

## 1. 项目概述

DBMind 是一款面向数据库开发者和数据分析师的桌面端 SQL 工作空间，核心理念是 **AI Native**：将大语言模型（LLM）深度集成到 SQL 编辑、查询和数据库管理的工作流中。用户可以通过自然语言描述需求，AI 结合实时 Schema 上下文自动生成、优化和解释 SQL。

### 1.1 核心特性

- **SQL 编辑器**：基于 Monaco Editor，支持多 Tab、持久化、自动补全、语法高亮、SQL 格式化、错误行标注
- **查询执行**：多语句分批执行、EXPLAIN 计划查看、查询历史记录、查询取消
- **数据库管理**：多连接管理、Schema 树浏览、增量/全量 Schema 刷新、DDL 生成
- **AI 助手**：自然语言转 SQL（NL2SQL）、SQL 解释与优化、Schema 感知上下文、流式响应、多 AI 提供商支持
- **结果展示**：虚拟化数据网格（Glide Data Grid）、按需单元格加载、大数据集支持

### 1.2 技术选型

| 层次 | 技术 | 说明 |
|------|------|------|
| 桌面外壳 | Tauri v2 | 替代 Electron，包体积更小、内存占用更低、启动更快 |
| 前端 | React 19 + TypeScript + Vite 7 | 现代 React 生态，Vite 提供极速开发体验 |
| 后端 | Rust (tokio 异步运行时) | 高性能、内存安全，tokio 提供异步并发能力 |
| SQL 编辑器 | Monaco Editor | VS Code 同款编辑器内核，支持丰富的语言服务 |
| 数据网格 | Glide Data Grid | 高性能虚拟化网格，支持大数据集平滑滚动 |
| 状态管理 | Zustand | 轻量级 React 状态管理 |
| 数据库驱动 | mysql_async / tokio-postgres | Rust 原生异步数据库驱动 |
| AI 通信 | reqwest (HTTP SSE) | 支持 OpenAI / Ollama / OpenAI 兼容 API |
| 结果缓存 | rusqlite (内嵌 SQLite) | 大结果集 SQLite 落盘，小结果集内存存储 |

---

## 2. 系统架构

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                      Tauri Shell                             │
│                                                              │
│  ┌────────────────────────┐    ┌──────────────────────────┐  │
│  │     React Frontend     │    │      Rust Backend        │  │
│  │     (Vite + TSX)       │◄──►│    (Tauri Commands)      │  │
│  │                        │IPC │                          │  │
│  │  Monaco Editor         │    │  ┌──────────────────┐    │  │
│  │  Glide Data Grid       │    │  │  dbmind-db       │    │  │
│  │  Zustand Stores        │    │  │  dbmind-query    │    │  │
│  │  Lucide Icons          │    │  │  dbmind-schema   │    │  │
│  │  react-markdown        │    │  │  dbmind-sql      │    │  │
│  └────────────────────────┘    │  │  dbmind-ai       │    │  │
│                                │  │  dbmind-cache    │    │  │
│                                │  │  dbmind-core     │    │  │
│                                │  └──────────────────┘    │  │
│                                └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

系统采用 **Tauri 双层架构**：

- **前端层**（WebView）：React SPA，负责 UI 渲染和用户交互
- **后端层**（Rust 进程）：负责数据库连接、查询执行、SQL 处理、AI 通信等计算密集型和 IO 操作
- **通信机制**：Tauri IPC（`invoke` 调用 + Event 事件推送）

### 2.2 前端布局

```
┌─────┬──────────────────────────────┬──────────────┐
│ Left│  Sidebar (Connection Tree)   │              │
│ Rail├──────────────────────────────┤   AI Panel   │
│     │  TopBar                      │              │
│     ├──────────────────────────────┤  - 对话历史   │
│     │  WorkTabStrip               │  - 消息气泡    │
│     ├──────────────────────────────┤  - 输入栏     │
│     │  SqlEditor (Monaco)          │              │
│     ├──────────────────────────────┤              │
│     │  ResultGrid (Glide Grid)    │              │
│     │                              │              │
└─────┴──────────────────────────────┴──────────────┘
```

各面板支持拖拽调整宽度/高度，布局状态由 `uiStore` 管理。

---

## 3. 后端设计（Rust）

### 3.1 Workspace 与 Crate 结构

```
src-tauri/
├── Cargo.toml              # workspace 根配置
├── src/
│   ├── main.rs             # Tauri 入口
│   ├── lib.rs              # 应用初始化、AppState、命令注册
│   ├── events.rs           # Tauri 事件定义与发射
│   └── commands/           # Tauri 命令处理层
│       ├── mod.rs
│       ├── connections.rs  # 连接管理命令
│       ├── query.rs        # 查询执行命令
│       ├── schema.rs       # Schema 操作命令
│       ├── ai.rs           # AI 交互命令
│       └── sql.rs          # SQL 工具命令
└── crates/
    ├── dbmind-core/         # 共享类型、trait、错误定义
    ├── dbmind-db/           # 数据库连接管理（MySQL/PostgreSQL）
    ├── dbmind-query/        # 查询服务（执行、取消、结果缓存）
    ├── dbmind-schema/       # Schema 索引与刷新
    ├── dbmind-sql/          # SQL 工具库（格式化、分割、验证、提取）
    ├── dbmind-ai/           # AI 上下文引擎与提供商
    └── dbmind-cache/        # 分层结果存储（内存 + SQLite）
```

### 3.2 核心类型定义（dbmind-core）

`dbmind-core` 是所有 crate 的公共依赖，定义了全系统共享的数据类型和 trait。

#### 关键类型

| 类型 | 说明 |
|------|------|
| `ConnectionConfig` | 数据库连接配置（host, port, driver, SSL, SSH 等） |
| `DatabaseDriver` | 数据库驱动枚举：MySQL / PostgreSQL / SQLite |
| `ColumnMeta` | 列元数据（名称、类型、是否主键、注释等） |
| `CellValue` | 单元格值枚举：Null / Bool / Int / Float / String / Blob |
| `CellBlock` | 单元格块（用于虚拟化按需加载） |
| `TableSchema` | 完整表结构（列、索引、外键、行数、注释） |
| `QueryResultMeta` | 查询结果元数据（列信息、状态、行数、执行时间等） |
| `QueryStatus` | 查询状态枚举：Running / Ready / Error / Cancelled |
| `SchemaSummary` | AI 上下文用的 Schema 摘要 |

#### 核心 Trait

```rust
// 数据库连接管理
#[async_trait]
pub trait ConnectionManager: Send + Sync {
    async fn connect(&self, config: &ConnectionConfig) -> Result<String, DbError>;
    async fn disconnect(&self, connection_id: &str) -> Result<(), DbError>;
    async fn test_connection(&self, config: &ConnectionConfig) -> Result<bool, DbError>;
    fn active_connections(&self) -> Vec<String>;
}

// 查询执行器
#[async_trait]
pub trait QueryExecutor: Send + Sync {
    async fn execute_query(&self, connection_id: &str, sql: &str) -> Result<QueryResultMeta, DbError>;
    async fn cancel_query(&self, query_id: &str) -> Result<(), DbError>;
    async fn fetch_cells(&self, query_id: &str, ...) -> Result<CellBlock, DbError>;
}

// Schema 提供者
#[async_trait]
pub trait SchemaProvider: Send + Sync {
    async fn get_schema(&self, connection_id: &str, database: &str) -> Result<Vec<TableSchema>, SchemaError>;
    async fn get_table(&self, connection_id: &str, database: &str, table: &str) -> Result<TableSchema, SchemaError>;
    async fn search_tables(&self, connection_id: &str, query: &str) -> Result<Vec<TableBrief>, SchemaError>;
    async fn refresh_schema(&self, connection_id: &str, database: &str) -> Result<(), SchemaError>;
}
```

### 3.3 AppState（应用全局状态）

应用启动时初始化并注入 Tauri 的全局状态：

```rust
pub struct AppState {
    pub conn_manager:   Arc<ConnectionManagerImpl>,  // 连接管理器
    pub query_service:  Arc<QueryService>,           // 查询服务
    pub schema_index:   Arc<SchemaIndex>,            // Schema 内存索引
    pub schema_refresh: Arc<SchemaRefresh>,          // Schema 刷新器
    pub ai_engine:      Arc<AiContextEngine>,         // AI 上下文引擎
}
```

所有 Tauri 命令通过 `State<AppState>` 访问共享服务。

### 3.4 Tauri 命令层

命令层是前后端的桥梁，将 `invoke` 调用转化为后端服务调用：

| 命令 | 所在模块 | 功能 |
|------|---------|------|
| `connect` / `disconnect` / `test_connection` | connections | 数据库连接生命周期 |
| `list_connections` / `list_databases` / `delete_connection` | connections | 连接与数据库列表 |
| `execute_query` / `fetch_cells` / `cancel_query` | query | 查询执行与结果获取 |
| `get_schema` / `search_tables` / `search_all_tables` | schema | Schema 读取与搜索 |
| `refresh_schema` / `generate_ddl` | schema | Schema 刷新与 DDL 生成 |
| `chat` / `nl2sql` / `explain_sql` | ai | AI 对话与 SQL 分析 |
| `format_sql` / `split_sql` / `validate_sql` / `extract_tables` | sql | SQL 处理工具 |

### 3.5 Tauri 事件系统

后端通过 Tauri Event 机制向前端推送异步状态变更：

| 事件名 | Payload | 说明 |
|--------|---------|------|
| `query:started` | `QueryStartedPayload` | 查询开始执行 |
| `query:ready` | `QueryReadyPayload` | 查询完成，结果就绪 |
| `query:error` | `QueryErrorPayload` | 查询执行出错 |
| `query:cancelled` | `QueryCancelledPayload` | 查询被取消 |
| `schema:refreshed` | `SchemaRefreshedPayload` | Schema 刷新完成 |
| `ai:token` | `AiTokenPayload` | AI 流式响应 Token |

### 3.6 数据库连接管理（dbmind-db）

#### 架构设计

```
ConnectionManagerImpl
├── connections: RwLock<HashMap<String, Box<dyn Driver>>>
├── configs: RwLock<HashMap<String, ConnectionConfig>>
└── Driver trait
    ├── MysqlDriver  (mysql_async)
    └── PostgresDriver (tokio-postgres)
```

- 使用 `RwLock<HashMap>` 管理多个并发连接
- `Driver` trait 抽象了不同数据库的连接和查询行为
- `ConnectionManagerImpl` 实现了 `ConnectionManager` trait

#### 连接池策略

当前使用 **单连接模式**（每个 ConnectionConfig 对应一个持久连接），适用于桌面工具场景（用户并发低、交互式查询为主）。

### 3.7 查询服务（dbmind-query）

```
QueryService（对外暴露）
  └── QueryExecutorImpl（实际执行）
        ├── ConnectionManagerImpl（获取连接）
        ├── dbmind-sql::validate（执行前校验）
        └── ResultStore（存储结果）
```

**查询执行流程**：

```
execute_query(conn_id, sql)
  │
  ├── 1. validate_sql(sql)          → 安全检查，生成 warnings
  ├── 2. ConnectionManager.exec_sql  → 通过数据库驱动执行
  ├── 3. ResultStore.store()        → 按行数选择存储层级
  └── 4. emit query:ready           → 通知前端
```

### 3.8 分层结果缓存（dbmind-cache）

设计目标：支持 **大结果集的按需加载**，不将全部数据一次传到前端。

```
ResultStore
├── Memory Store (RwLock<HashMap>)     ← 小结果集 (< 10,000 行)
└── SQLite Backend (rusqlite)          ← 大结果集 (>= 10,000 行)
    └── 临时文件: $TMPDIR/dbmind_results.db
    └── 按 Chunk 存储 (每 1,000 行一个 chunk)
    └── 1 小时 TTL 自动过期
```

**数据流**：

```
查询完成 → store(query_id, columns, rows)
                │
                ├── row_count < 10k → 全量存入内存 HashMap
                └── row_count >= 10k → JSON 序列化后分 chunk 存入 SQLite

前端滚动网格 → fetch_cells(query_id, row_start, row_end, col_start, col_end)
                │
                ├── Memory → 直接切片返回 CellBlock
                └── SQLite → 定位 chunk → 读取 → 切片 → 返回 CellBlock
```

### 3.9 Schema 索引（dbmind-schema）

```
SchemaIndex
├── tables: RwLock<HashMap<"db.table", TableSchema>>
├── usage_scores: RwLock<HashMap<"db.table", u64>>
└── SchemaRefresh
    ├── full_refresh()      → 全量读取 information_schema
    └── incremental_refresh() → 增量更新指定表
```

**核心能力**：

- **表搜索**：按名称/注释模糊搜索，支持单库和跨库搜索
- **使用频率追踪**：记录表访问频次，用于 AI 上下文选择最相关的表
- **AI 上下文构建**：将表结构序列化为 SchemaSummary，注入到 LLM prompt 中
- **增量刷新**：先清除旧数据再写入，避免脏数据

**Schema 刷新策略**：

```
PostgreSQL:
  - 如果当前连接的 database 不匹配目标 database，创建临时连接
  - 查询 information_schema + pg_catalog 获取列、索引、外键
  - 刷新完成后断开临时连接

MySQL:
  - 直接通过 information_schema 查询
  - 单连接可切换 database
```

### 3.10 SQL 工具库（dbmind-sql）

纯函数库，无状态，不依赖异步运行时：

| 模块 | 功能 | 关键实现 |
|------|------|---------|
| `split` | SQL 语句分割 | 使用 `sqlparser` 解析，fallback 到分号分割；支持光标位置检测当前语句 |
| `validate` | 安全检查 | 检测 DROP TABLE、TRUNCATE、DELETE/UPDATE 无 WHERE 等危险操作 |
| `format` | SQL 格式化 | 关键字大写、缩进美化 |
| `quote` | 标识符引号 | 自动为含连字符等特殊字符的标识符添加反引号/双引号 |
| `extract` | 表名提取 | 从 SQL 中提取引用的表名，用于 AI 上下文和自动补全 |

### 3.11 AI 系统（dbmind-ai）

```
AiContextEngine（上下文构建）
├── SchemaIndex（Schema 数据源）
├── build_context() → AiContextBundle
│     ├── 根据 @提及的表 或 使用频率 选择相关表
│     └── 序列化为 SchemaSummary
│
├── modules（Prompt 模板）
│     ├── nl2sql_prompt()     → 自然语言转 SQL 的 system prompt
│     └── sql_explain_prompt() → SQL 解释的 prompt
│
└── providers（AI 提供商）
      └── OpenAiProvider（兼容 OpenAI / Ollama / 第三方 API）
            └── chat_stream() → SSE 流式响应
```

**支持的 AI 提供商**：

| 提供商 | 说明 |
|--------|------|
| `openai` | OpenAI 官方 API |
| `ollama` | 本地 Ollama 推理引擎 |
| `compatible` | 任何 OpenAI 兼容 API（默认配置为 DeepSeek） |

**流式响应机制**：

```
Tauri Command: chat()
  │
  ├── AiContextEngine.build_context()  → 构建含 Schema 的 prompt
  ├── OpenAiProvider.chat_stream()     → 发起 SSE 请求
  │     └── tokio::spawn → 逐行解析 SSE → tx.send(Token)
  └── 主线程: rx.recv() → emit("ai:token", { token })
        └── 前端: useTauriEvents.onAiToken → 追加到 streamBuffer → updateStore
```

---

## 4. 前端设计（React）

### 4.1 目录结构

```
src/
├── main.tsx                   # 应用入口
├── app/App.tsx                # 根组件（主题切换）
├── layouts/AppLayout.tsx      # 主布局（面板排列 + 拖拽调整）
├── features/
│   ├── connections/            # 连接管理
│   │   ├── ConnectionTree.tsx # 连接树（多连接 + 数据库复选框）
│   │   └── ConnectionForm.tsx # 新建/编辑连接表单
│   ├── schema-tree/           # Schema 浏览
│   │   ├── SchemaTree.tsx     # Database → Table → Column 树
│   │   └── TableStructureModal.tsx  # 表结构详情弹窗
│   ├── editor/                # SQL 编辑器
│   │   ├── SqlEditor.tsx      # Monaco Editor 封装
│   │   ├── TopBar.tsx         # 工具栏（执行、格式化、保存等）
│   │   └── WorkTabStrip.tsx   # 编辑器 Tab 栏（拖拽排序）
│   ├── result-grid/           # 查询结果
│   │   ├── ResultGrid.tsx     # 结果面板（多子 Tab + 元信息）
│   │   └── DataGrid.tsx       # Glide Data Grid 虚拟化渲染
│   ├── ai-chat/               # AI 助手
│   │   ├── AiPanel.tsx        # AI 面板容器
│   │   ├── AiInputBar.tsx     # 输入栏（支持 @提及表）
│   │   ├── AiMessageBubble.tsx# 消息气泡（Markdown + SQL 代码块）
│   │   ├── SqlBlock.tsx       # SQL 代码块（一键插入编辑器）
│   │   ├── AiConversationHeader.tsx  # 对话列表 + 新建
│   │   └── AiTableMention.tsx # @表提及弹窗
│   ├── navigation/            # 导航
│   │   ├── LeftRail.tsx       # 左侧图标栏
│   │   └── Sidebar.tsx        # 侧边栏（连接 + Schema 树）
│   └── settings/              # 设置
│       └── SettingsModal.tsx  # 设置弹窗（AI 配置等）
├── shared/
│   ├── api/
│   │   ├── types.ts           # 前后端共享类型定义
│   │   └── tauri.ts           # Tauri IPC 桥接（所有 invoke 封装）
│   ├── stores/                # Zustand 状态管理
│   │   ├── editorStore.ts     # 编辑器状态（Tab、SQL 内容、光标位置）
│   │   ├── connectionStore.ts # 连接状态（连接列表、选中、数据库）
│   │   ├── queryStore.ts      # 查询状态（结果、历史）
│   │   ├── chatStore.ts       # AI 对话状态（会话、消息、固定表）
│   │   ├── uiStore.ts         # UI 状态（主题、面板显隐、尺寸）
│   │   └── settingsStore.ts   # 设置状态（AI 配置持久化）
│   ├── hooks/
│   │   ├── useQueryExecution.ts  # 查询执行 hook
│   │   └── useTauriEvents.ts     # Tauri 事件监听 hook
│   ├── utils/
│   │   └── fuzzy.ts          # 模糊搜索工具
│   ├── sql/
│   │   ├── statements.ts      # 前端 SQL 语句处理
│   │   └── identifiers.ts     # 前端标识符处理
│   └── components/
│       └── ResizeHandle.tsx   # 拖拽调整手柄组件
└── styles/                    # CSS 样式文件
```

### 4.2 状态管理（Zustand Stores）

采用 **功能域划分** 的 Store 模式，每个 Store 职责单一：

| Store | 职责 | 持久化 |
|-------|------|--------|
| `uiStore` | 主题、面板显隐/尺寸 | 主题 → localStorage |
| `connectionStore` | 连接列表、活动连接、数据库选择、已连接状态 | — |
| `editorStore` | 编辑器 Tab、SQL 内容、光标位置 | Tab 内容 → localStorage |
| `queryStore` | 查询结果（Map）、查询历史 | 历史记录 → localStorage（最多 200 条） |
| `chatStore` | AI 对话列表、活动对话、消息、固定表 | 全量 → localStorage（最多 50 条） |
| `settingsStore` | AI 提供商配置 | 全量 → localStorage |

### 4.3 IPC 桥接层

`shared/api/tauri.ts` 封装了所有 Tauri `invoke` 调用，为每个后端命令提供类型安全的 TypeScript 函数：

```typescript
// 连接管理
connect(config) → Promise<string>        // 返回 connectionId
disconnect(connectionId) → Promise<void>
testConnection(config) → Promise<boolean>

// 查询
executeQuery(connectionId, sql, queryId?) → Promise<QueryResultMeta>
fetchCells(queryId, rowStart, rowEnd, ...) → Promise<CellBlock>
cancelQuery(queryId) → Promise<void>

// Schema
getSchema(database, table?) → Promise<TableSchema[]>
searchTables(database, query) → Promise<TableBrief[]>
refreshSchema(connectionId, database) → Promise<void>

// AI
aiChat(database, messages, currentSql?, pinnedDdl?, ...) → Promise<string>
nl2sql(database, question, ...) → Promise<string>
explainSql(sql, ...) → Promise<string>

// SQL 工具
formatSql(sql) → Promise<string>
splitSql(sql) → Promise<string[]>
validateSql(sql) → Promise<string[]>
extractTables(sql) → Promise<string[]>
```

### 4.4 AI 聊天面板设计

**对话模型**：

```typescript
interface Conversation {
  id: string;
  title: string;              // 自动取第一条用户消息前 50 字符
  database: string;           // 关联的数据库名
  driver?: string;             // 数据库驱动类型
  messages: ChatMsg[];         // 对话消息列表
  pinnedTables: PinnedTable[]; // 用户 @提及并固定的表
  createdAt: number;
  updatedAt: number;
}
```

**@提及机制**：

- 用户在输入栏输入 `@` 触发表名搜索弹窗
- 支持跨库搜索（`@db.table`）
- 选中的表自动解析其 DDL，作为 pinned context 注入 AI prompt
- 粘贴的 `@db.table` 引用自动识别并固定

**流式渲染**：

- 后端通过 `ai:token` 事件逐 token 推送
- 前端 `useTauriEvents` hook 监听事件，累积到 `streamBuffer`
- 每收到一个 token，调用 `updateLastAssistantMessage` 触发 Zustand 状态更新
- `AiMessageBubble` 使用 `react-markdown` + `remark-gfm` 渲染 Markdown 内容

---

## 5. 核心数据流

### 5.1 查询执行完整流程

```
用户在 Monaco Editor 中编写 SQL
        │
        ▼
Cmd+Enter 触发 useQueryExecution hook
        │
        ▼
前端 splitSql() 或调用后端 split_sql()  → 获取语句列表
        │
        ▼
循环: 对每条语句 invoke('execute_query', { connectionId, sql })
        │
        ├── Rust: dbmind-sql::quote::quote_identifiers (自动修复标识符)
        ├── Rust: dbmind-sql::validate::validate_sql (安全检查)
        ├── Rust: ConnectionManager.exec_sql (执行查询)
        ├── Rust: ResultStore.store (存储结果)
        └── Rust: emit('query:ready', { queryId, columns, row_count, ... })
                │
                ▼
        前端 useTauriEvents 监听 query:ready
                │
                ├── queryStore.setResult(queryId, meta)
                └── ResultGrid 渲染新子 Tab
                        │
                        └── DataGrid 滚动时调用 fetchCells() 按需加载
```

### 5.2 AI NL2SQL 流程

```
用户在 AI 输入栏输入自然语言问题
        │
        ├── 可选: @提及表 → pinnedDdl 注入
        │
        ▼
invoke('nl2sql', { database, question, apiKey, model, ... })
        │
        ├── Rust: AiContextEngine.build_context()
        │     ├── 查找 @提及的表
        │     ├── 若无提及 → 获取 Top 10 高频表
        │     └── SchemaIndex.build_ai_context() → SchemaSummary
        │
        ├── Rust: nl2sql_prompt(context, question) → 构建 system prompt
        │
        ├── Rust: OpenAiProvider.chat_stream() → SSE 流式请求
        │     └── 逐 token → emit('ai:token', { token })
        │
        └── 前端: 累积 token → 渲染 Markdown + SQL 代码块
                │
                └── 用户点击 SqlBlock "Insert" → SQL 插入编辑器
```

---

## 6. 数据持久化策略

| 数据 | 存储位置 | 格式 | 说明 |
|------|---------|------|------|
| 数据库连接配置 | localStorage | JSON | 连接信息明文存储（桌面应用安全边界） |
| 编辑器 Tab 内容 | localStorage | JSON | 包含 SQL、光标位置、滚动偏移 |
| 查询历史 | localStorage | JSON | 最多 200 条，按时间倒序 |
| AI 对话 | localStorage | JSON | 最多 50 条会话 |
| AI 配置 | localStorage | JSON | API Key、URL、模型等 |
| 主题偏好 | localStorage | JSON | light/dark + 系统偏好检测 |
| 查询结果（小） | 内存 HashMap | Rust 对象 | < 10,000 行，进程结束即消失 |
| 查询结果（大） | 临时 SQLite 文件 | JSON 分 chunk | ≥ 10,000 行，1 小时 TTL |
| Schema 索引 | 内存 HashMap | Rust 对象 | 进程结束即消失，启动后需刷新 |

---

## 7. Crate 依赖关系

```
dbmind-core          ← 所有 crate 依赖的基础层
    ↑
    ├── dbmind-db    ← 依赖 dbmind-core
    ├── dbmind-sql   ← 依赖（仅 serde, sqlparser, regex）
    ├── dbmind-cache ← 依赖 dbmind-core
    ├── dbmind-schema← 依赖 dbmind-core + dbmind-db
    ├── dbmind-query ← 依赖 dbmind-core + dbmind-db + dbmind-sql + dbmind-cache
    └── dbmind-ai    ← 依赖 dbmind-core + dbmind-schema + dbmind-sql
```

层级从底到顶：`core` → `db` / `sql` / `cache` → `schema` / `query` / `ai`

---

## 8. 错误处理

每个 crate 通过 `thiserror` 定义独立的错误类型：

| Crate | 错误类型 | 说明 |
|-------|---------|------|
| dbmind-core | `DbError` | 通用数据库错误（NotConnected, DriverError, QueryError） |
| dbmind-core | `SchemaError` | Schema 读取错误 |
| dbmind-core | `AiError` | AI 通信错误 |
| dbmind-ai | `AiProvider` 级错误 | HTTP 超时、API 错误、流解析错误 |

后端错误通过 Tauri IPC 的 Result 传递到前端，命令层负责将 Rust 错误转换为前端可处理的错误消息。

前端通过 `QueryResultMeta.error` 字段和 `ai:token` 事件的 `Error` 类型消息展示错误。

---

## 9. 安全考虑

- **CSP**: 当前配置为 `null`（桌面应用场景，无远程内容风险）
- **SQL 注入防护**: `validate_sql` 对危险操作发出警告；Schema 查询使用参数化
- **API Key 存储**: 存储在 localStorage（桌面应用安全边界，未来可迁移到 Tauri keychain 插件）
- **连接密码**: 明文存储在 localStorage（未来考虑系统密钥链集成）

---

## 10. 构建与分发

### 10.1 开发流程

```bash
npm install          # 安装前端依赖
npm run tauri:dev    # 启动开发模式（Vite 热更新 + Tauri）
npm run typecheck    # TypeScript 类型检查
npm run build        # 前端构建
npm run tauri:build  # 生产构建 + 安装包
```

### 10.2 分发格式

| 平台 | 格式 |
|------|------|
| macOS Apple Silicon | DMG |
| macOS Intel | DMG |
| Windows | MSI |
| Linux | AppImage / DEB |

---

## 11. 未来演进方向

- **SQLite 支持**: `dbmind-db` 已预留 SQLite driver 接口，待实现
- **系统密钥链**: 将密码和 API Key 迁移到 OS 密钥链
- **连接池**: 对高频查询场景引入连接复用
- **Schema 持久化**: 将 Schema 索引持久化到本地 SQLite，避免每次启动重新加载
- **多标签结果对比**: 支持多个查询结果并排对比
- **ER 图可视化**: 基于 Schema 索引自动生成 ER 关系图
- **查询性能分析**: 集成执行计划可视化分析
- **协作功能**: 查询和对话分享
