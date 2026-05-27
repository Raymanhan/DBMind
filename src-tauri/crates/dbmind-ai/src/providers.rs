use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio_stream::StreamExt;

use dbmind_core::errors::AiError;

/// Stream item for AI responses
pub enum AiStreamItem {
    Token(String),
    Done,
    Error(String),
}

/// AI provider trait
#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<tokio::sync::mpsc::Receiver<AiStreamItem>, AiError>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// OpenAI-compatible provider
pub struct OpenAiProvider {
    api_key: String,
    api_url: String,
    model: String,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
}

impl OpenAiProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            api_url: "https://api.openai.com/v1".to_string(),
            model,
            max_tokens: None,
            temperature: None,
        }
    }

    pub fn with_api_url(mut self, url: String) -> Self {
        self.api_url = url;
        self
    }

    pub fn with_max_tokens(mut self, max_tokens: Option<u32>) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    pub fn with_temperature(mut self, temperature: Option<f32>) -> Self {
        self.temperature = temperature;
        self
    }
}

#[async_trait]
impl AiProvider for OpenAiProvider {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<tokio::sync::mpsc::Receiver<AiStreamItem>, AiError> {
        let (tx, rx) = tokio::sync::mpsc::channel(100);

        let api_url = format!("{}/chat/completions", self.api_url);
        let api_key = self.api_key.clone();
        let model = self.model.clone();

        let max_tokens = self.max_tokens;
        let temperature = self.temperature;

        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_default();

            let mut body = serde_json::json!({
                "model": model,
                "messages": messages.iter().map(|m| {
                    serde_json::json!({
                        "role": m.role,
                        "content": m.content
                    })
                }).collect::<Vec<_>>(),
                "stream": true,
            });

            if let Some(mt) = max_tokens {
                body["max_tokens"] = serde_json::json!(mt);
            }
            if let Some(t) = temperature {
                body["temperature"] = serde_json::json!(t);
            }

            match client
                .post(&api_url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
            {
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        let status_code = status.as_u16();
                        let error_body = resp.text().await.unwrap_or_else(|_| String::new());
                        let error_msg = if !error_body.is_empty() {
                            // Try to extract OpenAI-style error message
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&error_body) {
                                parsed["error"]["message"]
                                    .as_str()
                                    .unwrap_or_else(|| parsed["message"].as_str().unwrap_or(&error_body))
                                    .to_string()
                            } else {
                                error_body
                            }
                        } else {
                            format!("HTTP {}", status_code)
                        };
                        let _ = tx.send(AiStreamItem::Error(format!("API error (HTTP {}): {}", status_code, error_msg))).await;
                        return;
                    }

                    let mut stream = resp.bytes_stream();
                    let mut line_buf = String::new();
                    while let Some(chunk) = stream.next().await {
                        match chunk {
                            Ok(bytes) => {
                                line_buf.push_str(&String::from_utf8_lossy(&bytes));
                                // Process complete lines only
                                while let Some(newline_pos) = line_buf.find('\n') {
                                    let line = line_buf[..newline_pos].trim().to_string();
                                    line_buf = line_buf[newline_pos + 1..].to_string();
                                    if let Some(content) =
                                        line.strip_prefix("data: ").and_then(parse_stream_line)
                                    {
                                        let _ = tx.send(AiStreamItem::Token(content)).await;
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = tx.send(AiStreamItem::Error(format!("Stream error: {}", e))).await;
                                return;
                            }
                        }
                    }
                    // Flush remaining buffer
                    if !line_buf.trim().is_empty() {
                        if let Some(content) =
                            line_buf.trim().strip_prefix("data: ").and_then(parse_stream_line)
                        {
                            let _ = tx.send(AiStreamItem::Token(content)).await;
                        }
                    }
                    let _ = tx.send(AiStreamItem::Done).await;
                }
                Err(e) => {
                    let _ = tx.send(AiStreamItem::Error(format!("Request failed: {}", e))).await;
                }
            }
        });

        Ok(rx)
    }
}

fn parse_stream_line(line: &str) -> Option<String> {
    if line == "[DONE]" {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(line).ok()?;
    parsed["choices"][0]["delta"]["content"]
        .as_str()
        .map(|s| s.to_string())
}
