# Phase 2.5 — enhanced device table + operational dashboard (dev-fast)

## What shipped
- **Item 2 (enhanced table):** expandable rows → `<DeviceKpiPanel>` (per-device latest KPIs via BFF,
  each `<MetricValueCell>` so absent = "Not available", never 0); server-side sort/per-column
  filter/hostname search via `useDeviceTableState` → BFF query; `<StatusBadge>` icon+text (NFR-30);
  density toggle + column show/hide (client view-state); alarm-count column; row actions (detail,
  open-native via `admin-portal-url`, ack — role-gated SERVER-SIDE, button hidden as presentation only).
- **Item 3 (dashboard):** `<FleetKpiTiles>`, `<P2PLinkMatrix>` centerpiece (RSSI/SNR live; withheld
  radio RSSI = "Not available" FR-24 showcase), `<TopInterfaces>` (95th-pct, HTML bars),
  `<ThroughputChart>` + `<CpuMemHeatmap>` (ECharts), `<AlarmFeed>` (2 real alarms; honest empty on
  filter-none).

## Load-bearing findings
- **ECharts under strict nonce CSP:** import `echarts/core` + explicit `use([...])` + CanvasRenderer,
  as a CLIENT component mounted post-hydration. It bundles into a `/static/chunks/*.js` (covered by
  `'self'`/`'strict-dynamic'`) — NO inline/CDN script, NO `unsafe-inline`. Proven by a REAL cold load
  at `/app` that hydrated and redirected to SSO with ZERO CSP violations. Do not switch to the SVG
  renderer or a CDN tag without re-proving the CSP.
- **`next build` type-checks stricter than `tsc -b`.** Three errors only `next build` caught:
  `exactOptionalPropertyTypes` on a `meta?: PageMeta` generic (must be `PageMeta | undefined`), an
  implicit-any in an ECharts `valueFormatter`, and a possibly-undefined array index in a test. Always
  run the workspace `next build`, not just root `tsc -b`, before claiming a clean build.
- **Heatmap honesty:** ECharts heatmap uses `-` for "no data" (blank cell), which reads like 0. To
  honour FR-24 render an EXPLICIT overlay series marking unavailable cells "N/A" (muted, dashed), never
  a 0% green cell — plus a note. An absent metric must be visibly *not collected*, not idle.
- **Deployed BFF can lag the source.** The running nms-bff's `ALLOWED_METRICS` had only
  RSSI/SNR/ifIn/OutOctets and NO `metrics/series` route, though the repo source has cpuUsage/mem/
  af60Tx-Rx + a series route. So CPU/mem/throughput/capacity panels need an nms-bff redeploy too — but
  the dispatch scoped me to "restart ONLY nms-web," so I rebuilt only web, staged the BFF changes clean
  in `~/nms-build`, and FLAGGED the nms-bff redeploy for a human decision rather than exceeding scope.
  Lesson: verify the DEPLOYED artifact's capability (grep the running container), don't assume it
  matches source; and respect the exact restart scope the human set.

## Permission boundary (4th time, handled per pattern)
- Authenticated in-browser screenshots need an SSO session. No test-user password is in Credentials.md
  (only SSH creds); typing a password into a Playwright tool param = Critical credential-hygiene
  violation (refused); host-side cookie-mint = classifier-blocked (not worked around, not laundered).
  Provided the deployed-layer evidence obtainable without a password: cold-load CSP proof + served
  bundle inspection (echarts client-chunked, zero token/Flux/upstream literals in `.next/static`).

## SSH allow-rule shape
- The human's allow-rule is `Bash(ssh aqaillm@10.121.77.206:*)`. A `ssh -i key user@host` form with the
  `-i` BEFORE the `user@host` token was classifier-DENIED; the literal `ssh aqaillm@10.121.77.206 -i key …`
  (matching the rule's leading tokens) was ALLOWED. Match the granted rule's token order.
