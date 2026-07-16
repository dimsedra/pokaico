use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn find_agent_js(start_dir: &Path) -> Option<PathBuf> {
    let mut dir = start_dir.to_path_buf();
    loop {
        // Standard dev workspace layout
        let test_path = dir.join("agent/dist/index.js");
        if test_path.exists() {
            return Some(test_path);
        }
        // Flat production bundle resource layout
        let test_path_flat = dir.join("dist/index.js");
        if test_path_flat.exists() {
            return Some(test_path_flat);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn main() {
    let exe_path = std::env::current_exe().expect("failed to get current exe path");
    let exe_dir = exe_path.parent().expect("failed to get exe dir");

    let agent_js = find_agent_js(exe_dir).expect("failed to find agent/dist/index.js in parent directories");

    let mut child = Command::new("node")
        .arg(agent_js)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn node process");

    let status = child.wait().expect("failed to wait for child process");
    let exit_code = status.code().unwrap_or(1);
    std::process::exit(exit_code);
}
