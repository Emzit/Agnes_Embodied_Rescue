# Upstream provenance

Agnes Harness source is vendored from the pinned upstream baseline below, with the current project integration patches included in this source snapshot.

- Upstream: https://github.com/AgnesAI-Labs/agnes-harness
- Pinned commit: fe90962a6b8561d8cae7e5d451905604fcf475cf
- Location: third_party/agnes-harness
- Full upstream tracked file set is included, with file modes and symlinks preserved.
- Upstream .git history, node_modules and machine-specific build output are not included.
- Preserve and comply with the upstream LICENSE and notices. The repository includes upstream public test fixtures containing intentionally fake tokens and localhost-only TLS test material; these are not project authentication secrets.
- Most project integrations live in scripts, services, packages and demo. This snapshot also includes existing Harness changes for model presets, MCP configuration/runtime, Web serving and their tests/documentation; it is not byte-identical to the pinned upstream baseline.
- Compare the vendored directory with the pinned upstream commit to inspect the complete local patch set. Publishing preserves these existing changes; it does not introduce new upstream implementation changes.

Publishing does not modify the original nested Git repository in the running server workspace. The outer repository is a source snapshot, not a forked upstream history.
