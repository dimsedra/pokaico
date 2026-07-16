use std::collections::HashMap;
use std::sync::{Mutex, Arc};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;
use tokio::sync::oneshot;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

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
    // Thread-safe map of pending request IDs to oneshot senders
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

#[tauri::command]
pub async fn chat(
    state: State<'_, Arc<SidecarState>>,
    message: String,
    session_id: String,
) -> Result<Value, String> {
    // 1. Generate unique request ID using atomic counter
    let req_num = REQ_COUNTER.fetch_add(1, Ordering::SeqCst);
    let request_id = format!("req-{}", req_num);

    // 2. Create oneshot channel
    let (tx, rx) = oneshot::channel();

    // 3. Register sender in pending map
    {
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        pending.insert(request_id.clone(), tx);
    }

    // Set up the RAII guard to clean up pending entry on early error/exit
    let mut guard = PendingGuard {
        state: state.inner().clone(),
        id: request_id.clone(),
        active: true,
    };

    // 4. Construct request payload
    let req = IPCRequest {
        id: request_id.clone(),
        command: "chat".to_string(),
        args: serde_json::json!({
            "message": message,
            "sessionId": session_id,
        }),
    };

    let serialized = serde_json::to_string(&req).map_err(|e| e.to_string())? + "\n";

    // 5. Write to sidecar stdin
    {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(child) = child_lock.as_mut() {
            child.write(serialized.as_bytes()).map_err(|e| e.to_string())?;
        } else {
            return Err("Sidecar is not running".to_string());
        }
    }

    // 6. Await response (with a 90 second timeout)
    let timeout = tokio::time::sleep(std::time::Duration::from_secs(90));
    tokio::select! {
        resp = rx => {
            // Deactivate guard as we received a resolution
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
            // Guard will automatically remove the pending request on drop
            Err("Request timed out after 90 seconds".to_string())
        }
    }
}

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

                    // Try parsing as IPCResponse
                    if let Ok(response) = serde_json::from_str::<IPCResponse>(trimmed) {
                        if let Ok(mut pending) = state.pending.lock() {
                            if let Some(tx) = pending.remove(&response.id) {
                                let _ = tx.send(response);
                                continue;
                            }
                        }
                    }

                    // If not a registered IPC response, print it as a standard sidecar stdout log
                    println!("[pokaico-agent stdout] {}", trimmed);
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    eprintln!("[pokaico-agent stderr] {}", line.trim());
                }
                CommandEvent::Terminated(status) => {
                    println!("[pokaico-agent] sidecar terminated with status: {:?}", status);
                    // Clear the child process from state
                    if let Ok(mut child) = state.child.lock() {
                        *child = None;
                    }
                    // Instantly wake up all pending requests with error to prevent hangs
                    if let Ok(mut pending) = state.pending.lock() {
                        pending.clear();
                    }
                }
                _ => {}
            }
        }
    });
}
