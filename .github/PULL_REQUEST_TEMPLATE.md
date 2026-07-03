## What & why

<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

## How I verified it

<!-- Tributary's bar (see CONTRIBUTING.md): exercise the flow you touched in a real browser,
     not just typecheck. Chromium's --use-fake-device-for-media-stream flag works well for
     camera-less testing. Tell us what you did. -->

- [ ] `pnpm typecheck` passes
- [ ] I drove the affected flow in a browser and it behaves as described
- [ ] Recording-path changes: chunks still persist to IndexedDB before upload, and uploads stay idempotent/resumable
