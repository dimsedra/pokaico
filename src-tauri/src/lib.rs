mod commands;

use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Initialize sidecar state
      let state = Arc::new(commands::SidecarState {
        child: Mutex::new(None),
        pending: Mutex::new(HashMap::new()),
      });

      // Spawn the pokaico-agent sidecar
      match app.shell().sidecar("pokaico-agent") {
        Ok(sidecar) => {
          match sidecar.spawn() {
            Ok((rx, child)) => {
              println!("[pokaico] Sidecar spawned successfully");
              // Store child handle
              if let Ok(mut child_lock) = state.child.lock() {
                *child_lock = Some(child);
              }
              // Start background reader loop
              commands::start_sidecar_reader_loop(Arc::clone(&state), rx);
            }
            Err(err) => {
              eprintln!("[pokaico] Error: Failed to spawn sidecar: {:?}", err);
            }
          }
        }
        Err(err) => {
          eprintln!("[pokaico] Error: Failed to resolve sidecar configuration: {:?}", err);
        }
      }

      // Manage state
      app.manage(state);

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![commands::chat])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
