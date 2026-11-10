//! Keep the web header in step with AppKit, before native controls reappear.
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
};
use objc2_app_kit::{
    NSWindowDidEnterFullScreenNotification, NSWindowDidExitFullScreenNotification,
    NSWindowWillEnterFullScreenNotification, NSWindowWillExitFullScreenNotification,
};
use objc2_foundation::{NSNotificationCenter, NSObjectProtocol};
use tauri::WebviewWindow;

struct TitlebarObserver {
    fullscreen_layout: Arc<AtomicBool>,
    tokens: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}

impl Drop for TitlebarObserver {
    fn drop(&mut self) {
        let center = NSNotificationCenter::defaultCenter();
        for token in &self.tokens {
            // Tokens belong to this center and are removed on the main thread.
            unsafe { center.removeObserver((**token).as_ref()) };
        }
    }
}

thread_local! {
    static OBSERVERS: RefCell<HashMap<String, TitlebarObserver>> = RefCell::new(HashMap::new());
}

fn apply_layout(window: &WebviewWindow, fullscreen: bool) {
    // Update CSS directly: no React render, resize IPC, or timeout in this path.
    let script = format!("document.documentElement.dataset.windowFullscreen = '{fullscreen}';");
    if let Err(error) = window.eval(script) {
        log::warn!("Could not update macOS titlebar layout: {error}");
    }
}

/// Called from Tauri setup on the main thread; never replace Tao's window delegate.
pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let native_window = window.ns_window()?;
    let fullscreen_layout = Arc::new(AtomicBool::new(window.is_fullscreen()?));
    let center = NSNotificationCenter::defaultCenter();
    let mut tokens = Vec::new();

    // Change spacing at the start of either transition, without waiting for
    // AppKit's fullscreen animation. Exit reserves space before controls return.
    // Completion notifications reaffirm the final layout.
    unsafe {
        let object = &*native_window.cast::<AnyObject>();
        for (name, fullscreen) in [
            (NSWindowWillEnterFullScreenNotification, true),
            (NSWindowDidEnterFullScreenNotification, true),
            (NSWindowWillExitFullScreenNotification, false),
            (NSWindowDidExitFullScreenNotification, false),
        ] {
            let window = window.clone();
            let state = fullscreen_layout.clone();
            let callback = RcBlock::new(move |_| {
                state.store(fullscreen, Ordering::Relaxed);
                apply_layout(&window, fullscreen);
            });
            // NSWindow posts these on the main thread. A nil queue delivers the
            // callback synchronously, scoped to this window only.
            tokens.push(center.addObserverForName_object_queue_usingBlock(
                Some(name),
                Some(object),
                None,
                &callback,
            ));
        }
    }

    OBSERVERS.with_borrow_mut(|observers| {
        observers.insert(
            window.label().to_owned(),
            TitlebarObserver {
                fullscreen_layout,
                tokens,
            },
        );
    });
    Ok(())
}

/// Reapply the current state after a page load, including webview reloads.
pub fn sync(window: WebviewWindow) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        OBSERVERS.with_borrow(|observers| {
            if let Some(observer) = observers.get(target.label()) {
                apply_layout(&target, observer.fullscreen_layout.load(Ordering::Relaxed));
            }
        });
    });
}

pub fn remove(window: &tauri::Window) {
    let label = window.label().to_owned();
    let _ = window.run_on_main_thread(move || {
        OBSERVERS.with_borrow_mut(|observers| {
            observers.remove(&label);
        });
    });
}
