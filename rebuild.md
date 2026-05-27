# DBMind 新架构

## 总体方向

**Tauri 2 + Rust Core + React UI + Monaco + Canvas Grid**

不是做“Electron 数据库客户端”，而是做：

```text
AI Native SQL Workspace
```

核心原则：

```text
UI 只负责显示
Rust 负责重活
数据结果不进 React state
大表格不走 DOM
AI 上下文不走前端拼接
```

Tauri 官方定位就是用 WebView 做 UI、Rust 做系统/后端逻辑，适合你这种“前端体验 + 本地高性能后端”的桌面应用。([Tauri][1])

---

# 一、新技术栈

| 层     | 技术                                       |
| ----- | ---------------------------------------- |
| 桌面壳   | Tauri 2                                  |
| 后端核心  | Rust                                     |
| UI    | React 19 + TypeScript                    |
| 构建    | Vite                                     |
| 编辑器   | Monaco Editor                            |
| 表格    | Glide Data Grid                          |
| 数据库驱动 | Rust SQLx / tokio-postgres / mysql_async |
| 本地缓存  | SQLite                                   |
| 分析缓存  | DuckDB 可选                                |
| AI    | OpenAI / Ollama / OpenAI-compatible      |
| 状态管理  | Zustand                                  |
| 请求状态  | TanStack Query                           |
| 国际化   | i18next                                  |
| 打包    | Tauri Bundler                            |

Monaco 本身是 VS Code 的核心编辑器，继续用没问题。([GitHub][2])
表格建议换成 Glide Data Grid，它是 Canvas-based grid，定位就是高性能大数据表格。([GitHub][3])

---

# 二、整体架构

```text
┌─────────────────────────────────────┐
│             React UI                 │
│  ┌──────────┐ ┌───────────────────┐ │
│  │ Monaco   │ │ Glide Data Grid    │ │
│  └──────────┘ └───────────────────┘ │
│  AI Chat / Schema Tree / Tabs        │
└─────────────────┬───────────────────┘
                  │ Tauri Command / Event
┌─────────────────▼───────────────────┐
│              Rust Core               │
│                                     │
│  ┌──────────────┐ ┌───────────────┐ │
│  │ DB Runtime   │ │ Query Engine   │ │
│  └──────────────┘ └───────────────┘ │
│  ┌──────────────┐ ┌───────────────┐ │
│  │ Schema Index │ │ AI Context     │ │
│  └──────────────┘ └───────────────┘ │
│  ┌──────────────┐ ┌───────────────┐ │
│  │ Result Store │ │ SQL Service    │ │
│  └──────────────┘ └───────────────┘ │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│        MySQL / PostgreSQL / Others   │
└─────────────────────────────────────┘
```

---

# 三、核心模块设计

## 1. App Shell

用 Tauri 2 替代 Electron。

负责：

```text
窗口
菜单
快捷键
文件系统
安全权限
自动更新
系统通知
```

优点：

```text
体积小
内存低
Rust 后端天然高性能
比 Electron 更适合长期桌面客户端
```

Tauri 2 支持主流桌面平台，也能结合任意前端框架和 Rust 后端逻辑。([Tauri][4])

---

## 2. Rust Core

这是 DBMind 的核心。

分这些 crate：

```text
dbmind-core
dbmind-db
dbmind-query
dbmind-schema
dbmind-ai
dbmind-sql
dbmind-cache
dbmind-ipc
```

建议目录：

```text
src-tauri/
  crates/
    dbmind-core/
    dbmind-db/
    dbmind-query/
    dbmind-schema/
    dbmind-ai/
    dbmind-sql/
    dbmind-cache/
```

---

## 3. 数据库连接层

不要再用 `mysql2 / pg`。

改成 Rust：

```text
MySQL: mysql_async
PostgreSQL: tokio-postgres / sqlx
SQLite: rusqlite
```

连接模型：

```text
ConnectionManager
  ├─ connection_id
  ├─ pool
  ├─ driver
  ├─ metadata cache
  └─ active queries
```

核心接口：

```rust
connect()
disconnect()
test_connection()
execute_query()
cancel_query()
fetch_rows()
refresh_schema()
```

---

## 4. 查询执行层

不要一次性返回 rows。

改成：

```text
execute_query
  ↓
返回 query_id + columns
  ↓
结果写入 Result Store
  ↓
前端按窗口区域拉取
```

接口：

```ts
executeQuery(sql): Promise<{
  queryId: string
  columns: ColumnMeta[]
  status: "running" | "ready" | "error"
}>

fetchCells(queryId, rowStart, rowEnd, colStart, colEnd): Promise<CellBlock>
```

重点：

```text
表格滚到哪里
才取哪里的数据
```

---

## 5. Result Store

这是性能关键。

不要把结果集放 React。

建议：

```text
小结果：Rust memory store
中结果：SQLite temp table
大结果：Arrow / Parquet / DuckDB
```

分级策略：

| 数据量          | 存储             |
| ------------ | -------------- |
| < 1 万行       | Rust memory    |
| 1 万 - 100 万行 | SQLite temp    |
| > 100 万行     | DuckDB / Arrow |

DuckDB 对本地分析、CSV、Parquet、调优和直接读文件支持很好，适合作为结果分析缓存。([DuckDB][5])

---

## 6. 表格层

用：

```text
Glide Data Grid
```

不要：

```text
Ant Table
TanStack Table
普通 div table
```

表格数据模型：

```ts
type GridDataSource = {
  getCell(row: number, col: number): Promise<Cell>
  getBlock(
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number
  ): Promise<CellBlock>
}
```

前端只维护：

```text
当前 viewport
selection
scroll position
column width
sort/filter 状态
```

不维护：

```text
完整 rows
```

---

# 四、编辑器设计

## Monaco 继续用

但要变成：

```text
Monaco UI
+ Rust SQL Service
+ Web Worker
```

Monaco 是 VS Code 的编辑器核心。([microsoft.github.io][6])

### SQL 能力分层

```text
Monaco
  ├─ syntax highlight
  ├─ completion UI
  ├─ diagnostics UI
  └─ editor interaction

Rust SQL Service
  ├─ SQL split
  ├─ current statement detection
  ├─ SQL formatting
  ├─ table reference extraction
  ├─ schema-aware completion
  └─ error mapping
```

不要让 Monaco 直接分析复杂 schema。

---

# 五、Schema Index

这是 SQL IDE 的灵魂。

```text
SchemaIndex
  ├─ database
  ├─ schema
  ├─ table
  ├─ column
  ├─ index
  ├─ foreign key
  ├─ comment
  └─ usage score
```

落地：

```text
SQLite
```

用途：

```text
左侧表结构
自动补全
AI 上下文
表搜索
ER 关系
SQL 生成
```

刷新策略：

```text
首次连接全量拉取
后台增量刷新
用户手动刷新
query error 后局部刷新
```

---

# 六、AI 架构

AI 不应该在 React 里拼 prompt。

应该有：

```text
AI Context Engine
```

流程：

```text
用户问题
  ↓
识别意图
  ↓
召回相关表
  ↓
取 schema 摘要
  ↓
取当前 SQL / 错误 / 查询结果样例
  ↓
构造 prompt
  ↓
流式返回
```

AI 模块：

```text
NL2SQL
SQL Explain
SQL Fix
Chart Suggestion
Result Analysis
Schema Q&A
```

上下文控制：

```text
当前编辑 SQL
+ 当前连接
+ 当前库
+ 最近使用表
+ 相关表 TopK
+ 当前错误
+ 结果样例
```

---

# 七、IPC 设计

不要大 JSON 往返。

Tauri Command 只传：

```text
控制消息
query_id
page 参数
小块数据
```

大数据走：

```text
Result Store
```

事件走：

```text
Tauri Event
```

例如：

```text
query:started
query:progress
query:ready
query:error
query:cancelled
schema:refreshed
ai:token
```

---

# 八、前端结构

```text
src/
  app/
  layouts/
  features/
    connections/
    editor/
    result-grid/
    schema-tree/
    ai-chat/
    query-history/
    settings/
  shared/
    components/
    hooks/
    stores/
    api/
```

状态管理：

```text
Zustand：UI 状态
TanStack Query：异步请求状态
Monaco Model：SQL 文本状态
Rust Store：结果集状态
```

不要把 SQL 结果放 Zustand。

---

# 九、性能目标

| 模块           | 目标        |
| ------------ | --------- |
| 冷启动          | < 2s      |
| 空闲内存         | < 200MB   |
| 查询 10 万行     | UI 不阻塞    |
| 表格滚动         | 60fps     |
| Monaco 输入    | 无明显延迟     |
| Schema 1 万张表 | 搜索不卡      |
| AI 流式输出      | token 级响应 |



# 十、最终推荐架构一句话

```text
Tauri 2 + Rust Core + React UI + Monaco + Glide Data Grid + SQLite Schema Cache + Result Store + AI Context Engine
```
