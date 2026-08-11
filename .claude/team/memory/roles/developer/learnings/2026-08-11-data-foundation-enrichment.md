# Data-foundation enrichment (Phase 2.5) — Developer learnings, 2026-08-11

- **"Enrich the sims" ≠ add OIDs blindly — MEASURE what already lands first.** The dispatch assumed
  the sims needed enriching so the dashboard had real data, but a live InfluxDB query proved CPU +
  all AF60 RF (RSSI/SNR/Tx-Rx Capacity=mod-rate) ALREADY landed from real polling. The only real
  gap was switch/router memory. Querying the store before writing anything saved a large, risky,
  classification-breaking edit. Always confirm the observed state before "enriching".

- **The repo `packages/simulator` profiles are a SEPARATE authoring from the DEPLOYED
  `~/nms/snmpsim/gen_snmprec.py`** — different sysObjectIDs and a different AF60 OID tree
  (deployed uses the `.41112.1.11.1.3.1.*` station table indexed by MAC; repo uses `.41112.1.10`
  scalars). Deploying the repo `toSnmprec()` output would have re-classified the 4 live devices and
  broken the milestone. Enrich the DEPLOYED generator on the host; keep the repo profiles
  self-consistent for their own unit tests, but they are NOT the deploy source of truth.

- **LibreNMS hrStorage→memory needs THREE columns or it silently skips: hrStorageIndex(.1),
  hrStorageType==hrStorageRam(.2, an OID value → snmprec type 6), and Descr/Size/Used.** The exact
  tell is `discovery.php -m mempools` printing `hrStorage invalid: missing hrStorageIndex`. A row
  with only Descr/Size/Used is polled but never graphed → memory reads "unavailable" forever. RAM
  lands in the `mempool` measurement (used/free), NOT `storage` (that's disks).

- **Live InfluxDB field/tag names are not guessable — read them.** CPU field is `usage` (not
  `usage_perc`), mempool fields are `used`/`free` (not `perc_used`), all keyed by tag `hostname`.
  AF60 "mod-rate" surfaces as wireless-sensor `sensor_descr`="Tx Capacity"/"Rx Capacity"
  (sensor_class "rate"). Register readers against the OBSERVED schema, same lesson as the earlier
  wireless-sensor/ports finding.

- **Query InfluxDB via `influx query` INSIDE the nms-influxdb container** — its stored CLI config
  holds the token, so the operator never reads or echoes the token. This is the clean way to honour
  the key-only credential rule for a datastore that isn't behind the LibreNMS config file.
  Watch: influx CSV is CRLF — strip `\r` before piping to `bc`/`awk` or counts corrupt.

- **A real alert RULE that genuinely fires beats a populated-looking feed.** Set thresholds against
  the REAL polled values so alarms honestly fire (device-down on the real down host; CPU>=30 catches
  the router's real 34%). The RSSI rule I wrote didn't fire because AF60 RF is in `wireless-sensor`,
  not the `sensors` table my builder value matched — left as an honest no-op rather than
  re-engineered to force a fire. 2 real alarms > 3 rules where one fabricates.

- **D-1: LibreNMS 25.7.0 device page is path-style `.../device/<id>`** (routes/web.php
  `Route::prefix('device/{device}')`); the legacy `device=<id>` form still 200s via compat. The BFF
  already built the path form — verify-don't-guess turned a flagged decision into a no-op.
