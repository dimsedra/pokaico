use std::collections::HashMap;
use std::sync::{Mutex, Arc};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;
use tokio::sync::oneshot;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use std::fs;
use std::path::PathBuf;

static REQ_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Debug)]
pub struct IPCRequest {
    pub id: String,
    pub command: String,
    pub args: Value,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct IPCResponse {
    pub id: String,
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
}

pub struct SidecarState {
    pub child: Mutex<Option<CommandChild>>,
    pub pending: Mutex<HashMap<String, oneshot::Sender<IPCResponse>>>,
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(c) = child.take() {
                println!("[pokaico] App shutting down, terminating sidecar process");
                let _ = c.kill();
            }
        }
    }
}

struct PendingGuard {
    state: Arc<SidecarState>,
    id: String,
    active: bool,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        if self.active {
            if let Ok(mut pending) = self.state.pending.lock() {
                pending.remove(&self.id);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────
// UI Data Structs
// ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    pub id: String,
    pub sender: String, // "user" or "pokaico"
    pub text: String,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub messages: Vec<Message>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatSessionMeta {
    pub id: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiaryEntry {
    pub id: String,
    pub title: String,
    pub content: String,
    pub sentiment: String,
    pub date: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MemoryItem {
    pub id: String,
    pub category: String,
    pub details: String,
    pub learned_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProviderModelList {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "providerName")]
    pub provider_name: String,
    pub models: Vec<String>,
}

// ─────────────────────────────────────────────────────────
// Path Resolvers (matching agent/src/config.ts)
// ─────────────────────────────────────────────────────────

fn get_settings_file_path() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Failed to resolve home directory".to_string())?;
    
    #[cfg(target_os = "windows")]
    {
        let app_data = std::env::var("APPDATA")
            .unwrap_or_else(|_| format!("{}\\AppData\\Roaming", home));
        Ok(PathBuf::from(app_data).join("Pokaico").join("config.json"))
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        let xdg_config = std::env::var("XDG_CONFIG_HOME")
            .unwrap_or_else(|_| format!("{}/.config", home));
        Ok(PathBuf::from(xdg_config).join("pokaico").join("config.json"))
    }
}

fn get_data_dir() -> Result<PathBuf, String> {
    let settings_path = get_settings_file_path()?;
    if settings_path.exists() {
        if let Ok(content) = fs::read_to_string(&settings_path) {
            if let Ok(json) = serde_json::from_str::<Value>(&content) {
                if let Some(data_dir) = json.get("dataDir").and_then(|v| v.as_str()) {
                    return Ok(PathBuf::from(data_dir));
                }
            }
        }
    }
    // Default fallback: Documents/Pokaico
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Failed to resolve home directory".to_string())?;
    Ok(PathBuf::from(home).join("Documents").join("Pokaico"))
}

// ─────────────────────────────────────────────────────────
// File parsers
// ─────────────────────────────────────────────────────────

fn parse_frontmatter(content: &str) -> Option<(HashMap<String, String>, String)> {
    let normalized = content.replace("\r\n", "\n");
    let trimmed = normalized.trim_start();
    if !trimmed.starts_with("---\n") {
        return None;
    }
    let end_fm = trimmed[4..].find("\n---\n")?;
    let fm_part = &trimmed[4..end_fm + 4];
    let body_part = &trimmed[end_fm + 8..];

    let mut map = HashMap::new();
    for line in fm_part.lines() {
        let clean = line.split('#').next().unwrap_or("").trim();
        if let Some(idx) = clean.find(':') {
            let key = clean[..idx].trim().to_string();
            let value = clean[idx+1..].trim().to_string();
            map.insert(key, value);
        }
    }
    Some((map, body_part.to_string()))
}

fn parse_markdown_turns(body: &str) -> Vec<Message> {
    let mut messages = Vec::new();
    let mut current_sender: Option<String> = None;
    let mut current_time = String::new();
    let mut current_text = Vec::new();
    let mut id_counter = 0;

    for line in body.lines() {
        if line.starts_with("## [") {
            if let Some(sender) = current_sender.take() {
                messages.push(Message {
                    id: format!("msg-{}", id_counter),
                    sender,
                    text: current_text.join("\n").trim().to_string(),
                    timestamp: current_time.clone(),
                });
                id_counter += 1;
                current_text.clear();
            }

            if let Some(close_bracket) = line.find(']') {
                let time = &line[4..close_bracket];
                current_time = time.to_string();
                
                let role_part = line[close_bracket+1..].trim();
                let role_lower = role_part.to_lowercase();
                if role_lower.starts_with("user") {
                    current_sender = Some("user".to_string());
                } else {
                    // "pokai" or "tool" turns mapping
                    current_sender = Some("pokaico".to_string());
                }
            }
        } else if current_sender.is_some() {
            current_text.push(line);
        }
    }

    if let Some(sender) = current_sender {
        messages.push(Message {
            id: format!("msg-{}", id_counter),
            sender,
            text: current_text.join("\n").trim().to_string(),
            timestamp: current_time,
        });
    }

    messages
}

// ─────────────────────────────────────────────────────────
// Tauri Commands
// ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn chat(
    state: State<'_, Arc<SidecarState>>,
    message: String,
    session_id: String,
) -> Result<Value, String> {
    let req_num = REQ_COUNTER.fetch_add(1, Ordering::SeqCst);
    let request_id = format!("req-{}", req_num);
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        pending.insert(request_id.clone(), tx);
    }

    let mut guard = PendingGuard {
        state: state.inner().clone(),
        id: request_id.clone(),
        active: true,
    };

    let req = IPCRequest {
        id: request_id.clone(),
        command: "chat".to_string(),
        args: serde_json::json!({
            "message": message,
            "sessionId": session_id,
        }),
    };

    let serialized = serde_json::to_string(&req).map_err(|e| e.to_string())? + "\n";
    {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(child) = child_lock.as_mut() {
            child.write(serialized.as_bytes()).map_err(|e| e.to_string())?;
        } else {
            return Err("Sidecar is not running".to_string());
        }
    }

    let timeout = tokio::time::sleep(std::time::Duration::from_secs(90));
    tokio::select! {
        resp = rx => {
            guard.active = false;
            match resp {
                Ok(response) => {
                    if response.success {
                        Ok(response.data.unwrap_or(Value::Null))
                    } else {
                        Err(response.error.unwrap_or_else(|| "Unknown error".to_string()))
                    }
                }
                Err(_) => Err("Response channel closed before receiving response".to_string()),
            }
        }
        _ = timeout => {
            Err("Request timed out after 90 seconds".to_string())
        }
    }
}

#[tauri::command]
pub fn get_data_directory() -> Result<String, String> {
    let path = get_data_dir()?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_data_directory(path: String) -> Result<(), String> {
    let settings_path = get_settings_file_path()?;
    let parent = settings_path.parent().ok_or("Invalid settings path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    
    let json = serde_json::json!({ "dataDir": path });
    fs::write(&settings_path, serde_json::to_string_pretty(&json).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_conversations() -> Result<Vec<ChatSessionMeta>, String> {
    let data_dir = get_data_dir()?;
    let conv_dir = data_dir.join("conversation");
    if !conv_dir.exists() {
        return Ok(Vec::new());
    }

    let mut temp_sessions = Vec::new();
    let entries = fs::read_dir(conv_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Some((fm, _)) = parse_frontmatter(&content) {
                        let session_id = fm.get("session_id").cloned().unwrap_or_default();
                        let started_at = fm.get("started_at").cloned().unwrap_or_default();
                        let last_active = fm.get("last_active_at")
                            .or_else(|| fm.get("started_at"))
                            .cloned()
                            .unwrap_or_default();
                        
                        // Parse readable date from started_at
                        let date_str = started_at.split('T').next().unwrap_or("").to_string();

                        // Title is derived from filename prefix date-sessionid or default
                        let _file_name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                        // Title could be session_id or parsed from the file content's first turn
                        let mut title = session_id.clone();
                        
                        // Try to get title from first user message, matching App.tsx auto-title logic
                        let parsed_turns = parse_markdown_turns(&content);
                        if let Some(first_user) = parsed_turns.iter().find(|t| t.sender == "user") {
                            title = first_user.text.chars().take(20).collect();
                            if first_user.text.len() > 20 {
                                title.push_str("...");
                            }
                        }

                        if !session_id.is_empty() {
                            temp_sessions.push((
                                ChatSessionMeta {
                                    id: session_id,
                                    title,
                                    created_at: date_str,
                                },
                                last_active,
                            ));
                        }
                    }
                }
            }
        }
    }

    // Sort conversations descending by last_active (newest first)
    temp_sessions.sort_by(|a, b| b.1.cmp(&a.1));
    let sorted_sessions = temp_sessions.into_iter().map(|(meta, _)| meta).collect();
    Ok(sorted_sessions)
}

#[tauri::command]
pub fn read_conversation_file(id: String) -> Result<ChatSession, String> {
    let data_dir = get_data_dir()?;
    let conv_dir = data_dir.join("conversation");
    let entries = fs::read_dir(conv_dir).map_err(|e| e.to_string())?;
    
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Some((fm, body)) = parse_frontmatter(&content) {
                        if fm.get("session_id").map_or(false, |sid| sid == &id) {
                            let started_at = fm.get("started_at").cloned().unwrap_or_default();
                            let date_str = started_at.split('T').next().unwrap_or("").to_string();
                            let messages = parse_markdown_turns(&body);

                            let mut title = id.clone();
                            if let Some(first_user) = messages.iter().find(|t| t.sender == "user") {
                                title = first_user.text.chars().take(20).collect();
                                if first_user.text.len() > 20 {
                                    title.push_str("...");
                                }
                            }

                            return Ok(ChatSession {
                                id,
                                title,
                                messages,
                                created_at: date_str,
                            });
                        }
                    }
                }
            }
        }
    }
    Err("Conversation session not found".to_string())
}

#[tauri::command]
pub fn delete_conversation_file(id: String) -> Result<(), String> {
    let data_dir = get_data_dir()?;
    let conv_dir = data_dir.join("conversation");
    let entries = fs::read_dir(conv_dir).map_err(|e| e.to_string())?;
    
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Some((fm, _)) = parse_frontmatter(&content) {
                        if fm.get("session_id").map_or(false, |sid| sid == &id) {
                            fs::remove_file(path).map_err(|e| e.to_string())?;
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    Err("File not found to delete".to_string())
}

#[tauri::command]
pub fn list_diaries() -> Result<Vec<DiaryEntry>, String> {
    let data_dir = get_data_dir()?;
    let diary_dir = data_dir.join("diary");
    if !diary_dir.exists() {
        return Ok(Vec::new());
    }

    let mut diaries = Vec::new();
    let entries = fs::read_dir(diary_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Some((fm, body)) = parse_frontmatter(&content) {
                        let session_id = fm.get("session_id").cloned().unwrap_or_default();
                        let started_at = fm.get("started_at").cloned().unwrap_or_default();
                        
                        let date_str = started_at.split('T').next().unwrap_or("").to_string();
                        let body_trimmed = body.trim().to_string();

                        let title = format!("Reflections from {}", date_str);
                        let sentiment = if body_trimmed.contains("excited") || body_trimmed.contains("luar biasa") {
                            "excited"
                        } else if body_trimmed.contains("sedih") || body_trimmed.contains("lelah") {
                            "supportive"
                        } else if body_trimmed.contains("belajar") || body_trimmed.contains("saran") {
                            "reflective"
                        } else {
                            "cozy"
                        };

                        diaries.push(DiaryEntry {
                            id: session_id,
                            title,
                            content: body_trimmed,
                            sentiment: sentiment.to_string(),
                            date: date_str,
                        });
                    }
                }
            }
        }
    }

    // Sort newest diary entries first
    diaries.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(diaries)
}

#[tauri::command]
pub fn get_memory_items() -> Result<Vec<MemoryItem>, String> {
    let data_dir = get_data_dir()?;
    let db_path = data_dir.join("pokaico.db");
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    // Open SQLite connection safely using native rusqlite or just parsing directory topics
    // Crucial: The sqlite database can be read, but reading `/memory/topics/*/CONTEXT.md` on filesystem
    // is even more robust and doesn't require a rusqlite dependency.
    let topics_dir = data_dir.join("memory").join("topics");
    if !topics_dir.exists() {
        return Ok(Vec::new());
    }

    let mut memories = Vec::new();
    let entries = fs::read_dir(topics_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_dir() {
                let context_file = path.join("CONTEXT.md");
                if context_file.exists() {
                    let folder_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if folder_name == "user-profile" || folder_name == "user-background" || folder_name == "user-patterns" {
                        continue; // Skip foundational topics from basic visual graph to reduce clutter
                    }

                    if let Ok(content) = fs::read_to_string(&context_file) {
                        // Extract title / details from content
                        let clean_details = content
                            .lines()
                            .find(|line| !line.starts_with('#') && !line.trim().is_empty())
                            .unwrap_or(&folder_name)
                            .trim()
                            .to_string();

                        // Get learned_at / updated_at date
                        let metadata = fs::metadata(&context_file).map_err(|e| e.to_string())?;
                        let modified = metadata.modified().map_err(|e| e.to_string())?;
                        let datetime: chrono::DateTime<chrono::Local> = modified.into();
                        let learned_at = datetime.format("%b %d, %Y").to_string();

                        let category = if folder_name.contains("prefer") || folder_name.contains("like") || folder_name.contains("hobby") {
                            "preference"
                        } else if folder_name.contains("habit") || folder_name.contains("rout") {
                            "habit"
                        } else if folder_name.contains("feel") || folder_name.contains("sad") || folder_name.contains("happy") {
                            "feeling"
                        } else {
                            "fact"
                        };

                        memories.push(MemoryItem {
                            id: folder_name,
                            category: category.to_string(),
                            details: clean_details,
                            learned_at,
                        });
                    }
                }
            }
        }
    }
    
    Ok(memories)
}

#[tauri::command]
pub async fn get_available_providers(
    state: State<'_, Arc<SidecarState>>,
) -> Result<Vec<ProviderModelList>, String> {
    // 1. Send get_models command to sidecar via IPC
    let req_num = REQ_COUNTER.fetch_add(1, Ordering::SeqCst);
    let request_id = format!("req-{}", req_num);
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        pending.insert(request_id.clone(), tx);
    }

    let mut guard = PendingGuard {
        state: state.inner().clone(),
        id: request_id.clone(),
        active: true,
    };

    let req = IPCRequest {
        id: request_id.clone(),
        command: "get_models".to_string(),
        args: serde_json::json!({}),
    };

    let serialized = serde_json::to_string(&req).map_err(|e| e.to_string())? + "\n";
    {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(child) = child_lock.as_mut() {
            child.write(serialized.as_bytes()).map_err(|e| e.to_string())?;
        } else {
            return Err("Sidecar is not running".to_string());
        }
    }

    let timeout = tokio::time::sleep(std::time::Duration::from_secs(10));
    let raw_models = tokio::select! {
        resp = rx => {
            guard.active = false;
            match resp {
                Ok(response) => {
                    if response.success {
                        response.data.unwrap_or(Value::Null)
                    } else {
                        return Err(response.error.unwrap_or_else(|| "Unknown error".to_string()));
                    }
                }
                Err(_) => return Err("Response channel closed before receiving models".to_string()),
            }
        }
        _ = timeout => {
            return Err("Request timed out after 10 seconds".to_string());
        }
    };

    let models_val = raw_models.get("models").ok_or("Invalid response format: missing models field")?;
    let models_arr = models_val.as_array().ok_or("Invalid response format: models is not an array")?;

    // Supported 9 providers asked by user
    let allowed_providers = vec![
        ("openai", "OpenAI"),
        ("anthropic", "Anthropic"),
        ("google", "Google Gemini"),
        ("xai", "xAI"),
        ("moonshotai", "Moonshot AI"),
        ("zai", "Z.AI"),
        ("deepseek", "Deepseek"),
        ("openrouter", "OpenRouter"),
        ("opencode", "Opencode"),
        ("opencode-go", "Opencode Go"),
    ];

    let mut provider_map: HashMap<String, (String, Vec<String>)> = HashMap::new();
    for (pid, pname) in allowed_providers {
        provider_map.insert(pid.to_string(), (pname.to_string(), Vec::new()));
    }

    for m in models_arr {
        if let Some(pid) = m.get("providerId").and_then(|v| v.as_str()) {
            if let Some(mid) = m.get("modelId").and_then(|v| v.as_str()) {
                if let Some((_, ref mut models_vec)) = provider_map.get_mut(pid) {
                    models_vec.push(mid.to_string());
                }
            }
        }
    }

    let mut result = Vec::new();
    for (pid, (pname, mut models_vec)) in provider_map {
        if !models_vec.is_empty() {
            // Sort models alphabetically to make dropdown clean
            models_vec.sort();
            result.push(ProviderModelList {
                provider_id: pid,
                provider_name: pname,
                models: models_vec,
            });
        }
    }

    // Sort providers list alphabetically by provider ID
    result.sort_by(|a, b| a.provider_id.cmp(&b.provider_id));

    Ok(result)
}

#[tauri::command]
pub async fn save_provider_config(
    role: String,
    provider_id: String,
    model_id: String,
    api_key: String,
) -> Result<(), String> {
    let settings_path = get_settings_file_path()?;
    let config_dir = settings_path.parent().ok_or("Invalid path")?;
    let provider_config_path = config_dir.join("provider-config.json");
    
    let mut config = if provider_config_path.exists() {
        if let Ok(content) = fs::read_to_string(&provider_config_path) {
            serde_json::from_str::<Value>(&content).unwrap_or_else(|_| {
                serde_json::json!({
                    "apiKeys": {}
                })
            })
        } else {
            serde_json::json!({
                "apiKeys": {}
            })
        }
    } else {
        serde_json::json!({
            "apiKeys": {}
        })
    };

    // Set updated values based on role
    if role == "chat" {
        config["activeChatProvider"] = serde_json::Value::String(provider_id.clone());
        config["activeChatModel"] = serde_json::Value::String(model_id);
    } else if role == "pipeline" {
        config["activePipelineProvider"] = serde_json::Value::String(provider_id.clone());
        config["activePipelineModel"] = serde_json::Value::String(model_id);
    } else {
        return Err("Invalid role: must be 'chat' or 'pipeline'".to_string());
    }
    
    if config["apiKeys"].is_null() {
        config["apiKeys"] = serde_json::json!({});
    }
    
    config["apiKeys"][provider_id] = serde_json::Value::String(api_key);

    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    fs::write(
        &provider_config_path, 
        serde_json::to_string_pretty(&config).unwrap()
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn save_api_key(
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    let settings_path = get_settings_file_path()?;
    let config_dir = settings_path.parent().ok_or("Invalid path")?;
    let provider_config_path = config_dir.join("provider-config.json");
    
    let mut config = if provider_config_path.exists() {
        if let Ok(content) = fs::read_to_string(&provider_config_path) {
            serde_json::from_str::<Value>(&content).unwrap_or_else(|_| {
                serde_json::json!({
                    "apiKeys": {}
                })
            })
        } else {
            serde_json::json!({
                "apiKeys": {}
            })
        }
    } else {
        serde_json::json!({
            "apiKeys": {}
        })
    };

    if config["apiKeys"].is_null() {
        config["apiKeys"] = serde_json::json!({});
    }

    config["apiKeys"][provider_id] = serde_json::Value::String(api_key);

    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    fs::write(
        &provider_config_path, 
        serde_json::to_string_pretty(&config).unwrap()
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn delete_api_key(
    provider_id: String,
) -> Result<(), String> {
    let settings_path = get_settings_file_path()?;
    let config_dir = settings_path.parent().ok_or("Invalid path")?;
    let provider_config_path = config_dir.join("provider-config.json");
    
    if !provider_config_path.exists() {
        return Ok(());
    }
    
    let content = fs::read_to_string(&provider_config_path).map_err(|e| e.to_string())?;
    let mut config: Value = serde_json::from_str(&content).unwrap_or_else(|_| {
        serde_json::json!({
            "apiKeys": {}
        })
    });

    if !config["apiKeys"].is_null() && config["apiKeys"].is_object() {
        if let Some(obj) = config["apiKeys"].as_object_mut() {
            obj.remove(&provider_id);
        }
    }

    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    fs::write(
        &provider_config_path, 
        serde_json::to_string_pretty(&config).unwrap()
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}


#[tauri::command]
pub async fn save_enabled_models(
    provider_id: String,
    models: Vec<String>,
) -> Result<(), String> {
    let settings_path = get_settings_file_path()?;
    let config_dir = settings_path.parent().ok_or("Invalid path")?;
    let provider_config_path = config_dir.join("provider-config.json");
    
    let mut config = if provider_config_path.exists() {
        if let Ok(content) = fs::read_to_string(&provider_config_path) {
            serde_json::from_str::<Value>(&content).unwrap_or_else(|_| {
                serde_json::json!({
                    "apiKeys": {},
                    "enabledModels": {}
                })
            })
        } else {
            serde_json::json!({
                "apiKeys": {},
                "enabledModels": {}
            })
        }
    } else {
        serde_json::json!({
            "apiKeys": {},
            "enabledModels": {}
        })
    };

    if config["enabledModels"].is_null() {
        config["enabledModels"] = serde_json::json!({});
    }

    config["enabledModels"][provider_id] = serde_json::to_value(models).map_err(|e| e.to_string())?;

    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    fs::write(
        &provider_config_path, 
        serde_json::to_string_pretty(&config).unwrap()
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn get_active_provider_config() -> Result<Value, String> {
    let settings_path = get_settings_file_path()?;
    let config_dir = settings_path.parent().ok_or("Invalid path")?;
    let provider_config_path = config_dir.join("provider-config.json");
    
    if provider_config_path.exists() {
        let content = fs::read_to_string(provider_config_path).map_err(|e| e.to_string())?;
        let json: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(json);
    }
    Ok(serde_json::json!({
        "activeProvider": "google",
        "activeModel": "gemini-2.0-flash-lite",
        "apiKeys": {}
    }))
}

// ─────────────────────────────────────────────────────────
// Sidecar background reader loop
// ─────────────────────────────────────────────────────────

pub fn start_sidecar_reader_loop(
    state: Arc<SidecarState>,
    mut rx: tokio::sync::mpsc::Receiver<CommandEvent>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    if let Ok(response) = serde_json::from_str::<IPCResponse>(trimmed) {
                        if let Ok(mut pending) = state.pending.lock() {
                            if let Some(tx) = pending.remove(&response.id) {
                                let _ = tx.send(response);
                                continue;
                            }
                        }
                    }
                    println!("[pokaico-agent stdout] {}", trimmed);
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    eprintln!("[pokaico-agent stderr] {}", line.trim());
                }
                CommandEvent::Terminated(status) => {
                    println!("[pokaico-agent] sidecar terminated with status: {:?}", status);
                    if let Ok(mut child) = state.child.lock() {
                        *child = None;
                    }
                    if let Ok(mut pending) = state.pending.lock() {
                        pending.clear();
                    }
                }
                _ => {}
            }
        }
    });
}
