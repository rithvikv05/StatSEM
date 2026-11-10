# StatSEM

Desktop structural equation modeling app with a React/TypeScript frontend,
Tauri shell, and native Rust backend. The desktop launches the Rust engine as
a bundled sidecar over a dynamically assigned loopback HTTP port. No Python
runtime is required.

## Requirements

- Node.js 22.12+ and npm
- Rust stable and the platform build prerequisites for Tauri 2
- macOS 13.3+ for the current numerical backend (system Accelerate LAPACK)

The shell contains Windows/Linux support, but the numerical backend still needs
verified providers on those platforms. Some legacy analysis/reporting endpoints
are not implemented in the native HTTP server. This source snapshot does not
claim complete Python feature parity or cross-platform numerical validation.

## Development

```sh
npm ci
npm --prefix frontend ci
npm run dev
```

The development hook builds the Rust sidecar, starts Vite on port 5185, and
launches the desktop app. The backend starts and stops with the app.

## Build an installer

```sh
npm run build
```

The build hook compiles the backend, places the target-specific executable in
`src-tauri/binaries/`, and builds the frontend before Tauri packages the app.
Installers are generated under `src-tauri/target/release/bundle/`.
Generated sidecars, dependency directories, and build output are ignored by Git.

## Checks

```sh
npm run test:backend
npm run build:frontend
npm run prepare:backend
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

## Source layout

- `frontend/`: React UI, model editor, results views, and local assets
- `src-tauri/`: desktop shell, licensing, sidecar lifecycle, and macOS titlebar
- `backend-rust/`: native statistics engine, local HTTP server, and SQLite storage
- `backend-rust/tests/`: Rust integration tests and their required reference data
- `tools/prepare-sidecar.mjs`: build and stage the backend for Tauri

Third-party backend notices are in `backend-rust/THIRD_PARTY_NOTICES.md`.
The legacy Python backend, migration artifacts, and sample project archives are
not part of this source repository.
