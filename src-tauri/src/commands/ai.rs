use crate::events;
use crate::AppState;
use dbmind_ai::providers::{AiProvider, ChatMessage, OpenAiProvider};
use tauri::State;

const SYSTEM_PROMPT: &str = r#"
You are DBMind, an expert AI SQL assistant integrated into a database management tool.

## Core Rules
- You MUST answer in the same language as the user's question (Chinese question → Chinese answer, English → English).
- Only discuss topics related to SQL, databases, schema design, query optimization, and data analysis.
- Never speculate about fields, tables, or data that are not provided in the schema context above.
- In ALL generated SQL, table references MUST be fully qualified with the database name, using the format `database_name`.`table_name`. NEVER reference a table by its bare name alone.
- If the schema context is insufficient to answer, explicitly state what information is missing instead of guessing.

## Response Format (STRICT)
You MUST follow this exact structure for every response:

1. **Problem Analysis** — Briefly explain your understanding of the question, which tables/columns are relevant, and your approach. Keep it concise (3-5 sentences max).

2. **SQL Query** — Provide the SQL in a fenced code block with the `sql` language tag:
```sql
SELECT ... FROM `database_name`.`table_name` ...
```

3. **Explanation** (optional) — If the SQL is complex, add a short note explaining key logic or potential gotchas.

## DO NOT:
- Do NOT invent or assume column names that are not in the provided schema.
- Do NOT provide generic database tutorials or unrelated information.
- Do NOT add disclaimers, greetings, or closing remarks unrelated to the answer.
- Do NOT output SQL outside of ```sql``` code blocks.
"#;

fn build_provider(
    api_key: String,
    model: String,
    api_url: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
) -> OpenAiProvider {
    let mut provider = OpenAiProvider::new(api_key, model);
    if let Some(url) = api_url {
        provider = provider.with_api_url(url);
    }
    provider = provider.with_max_tokens(max_tokens);
    provider = provider.with_temperature(temperature);
    provider
}

async fn consume_stream(
    app: &tauri::AppHandle,
    rx: &mut tokio::sync::mpsc::Receiver<dbmind_ai::providers::AiStreamItem>,
) -> Result<String, String> {
    let mut full_response = String::new();
    while let Some(item) = rx.recv().await {
        match item {
            dbmind_ai::providers::AiStreamItem::Token(token) => {
                events::emit_ai_token(
                    app,
                    events::AiTokenPayload {
                        token: token.clone(),
                    },
                );
                full_response.push_str(&token);
            }
            dbmind_ai::providers::AiStreamItem::Done => break,
            dbmind_ai::providers::AiStreamItem::Error(e) => {
                return Err(e);
            }
        }
    }
    Ok(full_response)
}

#[tauri::command]
pub async fn chat(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    database: String,
    messages: Vec<ChatMessage>,
    current_sql: Option<String>,
    pinned_ddl: Option<Vec<String>>,
    api_key: Option<String>,
    model: Option<String>,
    api_url: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    log::info!("[AI chat] api_key={} api_url={} model={} max_tokens={} temp={}", api_key.as_deref().unwrap_or("(none)"), api_url.as_deref().unwrap_or("(none)"), model.as_deref().unwrap_or("(none)"), max_tokens.map(|t| t.to_string()).unwrap_or_else(|| "default".to_string()), temperature.map(|t| t.to_string()).unwrap_or_else(|| "default".to_string()));

    let key = api_key
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .ok_or_else(|| {
            "No API key provided. Set OPENAI_API_KEY env var or configure in Settings.".to_string()
        })?;

    let model = model.unwrap_or_else(|| "gpt-4o-mini".to_string());

    let mut sys_parts = vec![
        SYSTEM_PROMPT.to_string(),
        format!("Database: {}", database),
    ];

    if let Some(ref ddl_list) = pinned_ddl {
        if !ddl_list.is_empty() {
            sys_parts.push("Referenced table schemas (use these exact column names, do NOT invent columns. In SQL output, always use fully qualified `database`.`table` format):\n".to_string());
            for ddl in ddl_list {
                sys_parts.push(format!("```sql\n{}\n```", ddl));
            }
        }
    }

    if let Some(ref sql) = current_sql {
        if !sql.trim().is_empty() {
            sys_parts.push(format!("Current SQL in editor:\n```sql\n{}\n```", sql));
        }
    }

    let system_msg = ChatMessage {
        role: "system".to_string(),
        content: sys_parts.join("\n\n"),
    };

    let mut all_messages = vec![system_msg];
    all_messages.extend(messages);

    let provider = build_provider(key, model, api_url, max_tokens, temperature);
    let mut rx = provider
        .chat_stream(all_messages)
        .await
        .map_err(|e| e.to_string())?;

    consume_stream(&app, &mut rx).await
}

#[tauri::command]
pub async fn nl2sql(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    database: String,
    question: String,
    api_key: Option<String>,
    model: Option<String>,
    api_url: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let key = api_key
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .ok_or_else(|| "No API key provided.".to_string())?;

    let model = model.unwrap_or_else(|| "gpt-4o-mini".to_string());

    let context = state
        .ai_engine
        .build_context(&database, None, &[], None)
        .await;

    let prompt = dbmind_ai::modules::nl2sql_prompt(&context, &question);

    let provider = build_provider(key, model, api_url, max_tokens, temperature);
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!("{}\n\n{}", SYSTEM_PROMPT, database),
        },
        ChatMessage {
            role: "user".to_string(),
            content: prompt,
        },
    ];

    let mut rx = provider
        .chat_stream(messages)
        .await
        .map_err(|e| e.to_string())?;

    consume_stream(&app, &mut rx).await
}

#[tauri::command]
pub async fn explain_sql(
    app: tauri::AppHandle,
    sql: String,
    api_key: Option<String>,
    model: Option<String>,
    api_url: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let key = api_key
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .ok_or_else(|| "No API key provided. Set OPENAI_API_KEY env var or configure in Settings.".to_string())?;

    let model = model.unwrap_or_else(|| "gpt-4o-mini".to_string());

    let prompt = dbmind_ai::modules::sql_explain_prompt(&sql);

    let provider = build_provider(key, model, api_url, max_tokens, temperature);
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: prompt,
        },
    ];

    let mut rx = provider
        .chat_stream(messages)
        .await
        .map_err(|e| e.to_string())?;

    consume_stream(&app, &mut rx).await
}
