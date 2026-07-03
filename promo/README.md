# Tributary promo kit

Remotion project that renders the launch video and the social card pack.
Rendered outputs land in `out/` (gitignored); post copy lives in
[POSTS.md](POSTS.md), asset licensing in [CREDITS.md](CREDITS.md).

## Render

```bash
npm install
npx remotion render promo out/tributary-promo.mp4 --codec=h264   # 57s video
for c in card-hero card-local card-tracks card-editor card-agents banner; do
  npx remotion still $c out/$c.png
done
npx remotion studio        # live-edit the comps
```

## Regenerating the source footage

`public/` needs a few captured assets that are gitignored (screen recording,
stills, music). With the dev server running (`pnpm dev` at the repo root):

1. `scripts/promo-footage.mjs` — records `host-flow.mp4` (a scripted
   host+guest session: countdown, REC, chat, camera toggle, upload complete,
   editor) using Playwright with gradient y4m fake cameras. See the script
   header for the y4m ffmpeg one-liners.
2. `scripts/readme-shots.mjs` — regenerates `docs/screenshots/*` (also used
   by the cards).
3. Music: download "Voxel Revolution" from incompetech.com into `public/`
   (CC BY 4.0 — keep the credit, see CREDITS.md). SFX are synthesized with
   ffmpeg; commands in the git history / script comments.
