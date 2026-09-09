# API Coverage — Phase 1

No external API integration: Phase 1 is a local-only SQLite board inside a Tauri desktop shell — the
only cross-process surfaces are the Tauri IPC command layer and the OS folder-picker dialog, both of
which are in-application boundaries rather than third-party services. The deterministic detector was
run over this phase's ROADMAP section and returned `detected: false`; no agent backend, forge, relay
or SDK is in scope until Phase 2.
