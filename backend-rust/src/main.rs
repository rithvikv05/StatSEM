//! HTTP service for the desktop app, plus the JSON-lines parity harness.
use std::io::{self, BufRead, Write};

fn main() {
    let mut host = None;
    let mut port = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => host = args.next(),
            "--port" => port = args.next().and_then(|value| value.parse().ok()),
            _ => {}
        }
    }
    if let (Some(host), Some(port)) = (host, port) {
        if let Err(error) = statsem_engine::server::serve(&host, port) {
            eprintln!("Native backend failed: {error}");
            std::process::exit(1);
        }
        return;
    }

    let stdout = io::stdout();
    let mut output = stdout.lock();
    for line in io::stdin().lock().lines() {
        let result = line.map_err(|e| e.to_string()).and_then(|line| {
            serde_json::from_str(&line)
                .map_err(|e| e.to_string())
                .and_then(statsem_engine::evaluate)
        });
        let reply = match result {
            Ok(value) => serde_json::json!({"result": value}),
            Err(error) => serde_json::json!({"error": error}),
        };
        if writeln!(output, "{reply}")
            .and_then(|_| output.flush())
            .is_err()
        {
            break;
        }
    }
}
