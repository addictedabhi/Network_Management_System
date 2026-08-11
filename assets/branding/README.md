# AIRNMS branding source assets

Human-supplied source assets for the AIRNMS rebrand. These are the **originals**; the processed,
served copies live in `packages/web/public/` (custom UI) and `deploy/librenms-podman/config/`
(native LibreNMS). Relocated here from the repo root so large binaries are not left stray.

| File | Spec | Used to produce |
|---|---|---|
| `Logo.png` | 1616×973 RGB, AIRNMS wordmark (cloud+plane glyph + "AIRNMS"), WHITE background | `airnms_logo.png` (cropped to content, white keyed to transparent, letterboxed to 340×64 RGBA) — staged in `packages/web/public/` and `deploy/librenms-podman/config/` |
| `AIRNMS_favicon.ico` | multi-size .ico (16/32/48) | `packages/web/public/favicon.ico` and `deploy/librenms-podman/config/airnms_favicon.ico` |
| `AIRNMS_favicon_256x256.png` | 256×256 RGBA round favicon | `packages/web/public/icon.png` (high-DPI/apple-touch) and kept as source under `deploy/.../config/` |

Processing (rootless, local PIL — no host contact): crop white margins to the glyph+wordmark bbox,
ramp alpha from opaque (colored/dark) to transparent (near-white `min(r,g,b) >= 245`), resize
aspect-preserved to fit within 340×64 with 4 px padding, center on a transparent canvas.
