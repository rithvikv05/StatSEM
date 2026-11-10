use std::io::{BufRead, BufReader};
#[cfg(debug_assertions)]
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

struct BackendProcess {
    child: Child,
    url: String,
}

static BACKEND_CHILD: Mutex<Option<BackendProcess>> = Mutex::new(None);

pub fn start_backend(app: &AppHandle) -> Result<(), String> {
    let mut candidate_paths = Vec::new();

    // `tauri dev` does not place the bundled sidecar beside the debug app.
    // Prefer the native Rust engine from this checkout so development cannot
    // silently fall back to the retired Python server.
    #[cfg(debug_assertions)]
    {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        candidate_paths.push(root.join("backend-rust/target/debug/statsem-engine"));
        candidate_paths.push(root.join("backend-rust/target/release/statsem-engine"));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidate_paths.push(parent.join("statsem-backend.exe"));
            candidate_paths.push(parent.join("statsem-backend"));
            candidate_paths.push(parent.join("binaries").join("statsem-backend.exe"));
            candidate_paths.push(parent.join("binaries").join("statsem-backend"));
            candidate_paths.push(parent.join("resources").join("statsem-backend.exe"));
            candidate_paths.push(parent.join("resources").join("statsem-backend"));
            candidate_paths.push(parent.join("statsem-backend-aarch64-apple-darwin"));
            candidate_paths.push(
                parent
                    .join("resources")
                    .join("statsem-backend-aarch64-apple-darwin"),
            );
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidate_paths.push(resource_dir.join("statsem-backend.exe"));
        candidate_paths.push(resource_dir.join("statsem-backend"));
        candidate_paths.push(resource_dir.join("binaries").join("statsem-backend.exe"));
        candidate_paths.push(resource_dir.join("binaries").join("statsem-backend"));
        candidate_paths.push(resource_dir.join("statsem-backend-aarch64-apple-darwin"));
        candidate_paths.push(
            resource_dir
                .join("binaries")
                .join("statsem-backend-aarch64-apple-darwin"),
        );
    }

    let mut found_path = None;
    for path in candidate_paths {
        if path.exists() && path.is_file() {
            found_path = Some(path);
            break;
        }
    }

    let exe_path = found_path.ok_or("Rust backend executable was not found")?;
    log::info!("Launching backend executable: {:?}", exe_path);
    let mut cmd = Command::new(&exe_path);
    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("0")
        .stdout(Stdio::piped());

    // Keep backend working directory outside `src-tauri/` so `tauri dev`
    // file watchers cannot be triggered by sidecar working-directory writes.
    if let Ok(home) = app.path().home_dir() {
        cmd.current_dir(home);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not launch Rust backend: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Backend startup pipe unavailable")?;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = sender.send(result);
    });

    let address = receiver.recv_timeout(Duration::from_secs(8));
    let url = match address {
        Ok(Ok(line)) => line
            .trim()
            .strip_prefix("STATSEM_READY ")
            .filter(|url| url.starts_with("http://127.0.0.1:"))
            .map(str::to_owned)
            .ok_or_else(|| format!("Unexpected backend startup response: {line:?}")),
        Ok(Err(error)) => Err(format!("Backend startup failed: {error}")),
        Err(_) => Err("Backend did not become ready within eight seconds".into()),
    };
    match url {
        Ok(url) => {
            log::info!("Rust backend PID {} ready at {}", child.id(), url);
            *BACKEND_CHILD.lock().map_err(|e| e.to_string())? = Some(BackendProcess { child, url });
            Ok(())
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
    }
}

#[tauri::command]
pub fn backend_url() -> Result<String, String> {
    let mut process = BACKEND_CHILD.lock().map_err(|e| e.to_string())?;
    let backend = process.as_mut().ok_or("Rust backend is not running")?;
    if backend
        .child
        .try_wait()
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("Rust backend has stopped".into());
    }
    Ok(backend.url.clone())
}

pub fn stop_backend() {
    let mut lock = BACKEND_CHILD.lock().unwrap();
    if let Some(mut backend) = lock.take() {
        log::info!("Stopping backend process...");
        let _ = backend.child.kill();
        let _ = backend.child.wait();
    }
}
