mod backend_runner;
mod license;
#[cfg(target_os = "macos")]
mod macos_titlebar;

use tauri::Manager;

#[tauri::command]
fn desktop_platform() -> &'static str {
    std::env::consts::OS
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                macos_titlebar::install(&window)?;
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            backend_runner::start_backend(app.handle()).map_err(std::io::Error::other)?;

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .on_page_load(|webview, payload| {
            #[cfg(target_os = "macos")]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                if let Some(window) = webview.app_handle().get_webview_window(webview.label()) {
                    macos_titlebar::sync(window);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (webview, payload);
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                #[cfg(target_os = "macos")]
                macos_titlebar::remove(window);
                // If all windows are closed, terminate backend child process
                if window.app_handle().webview_windows().is_empty() {
                    backend_runner::stop_backend();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            backend_runner::backend_url,
            desktop_platform,
            license::get_license_status,
            license::activate_license,
            license::deactivate_license,
            license::get_machine_fingerprint,
            license::export_license_token,
            license::dev_mint_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
