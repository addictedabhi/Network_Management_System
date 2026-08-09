-- NMS POC TimescaleDB bootstrap + RETENTION POLICY
-- PRECONDITION OF FIRST START (human decision, option 1, 2026-08-09).
-- Rationale: $HOME is on /opt/airlinq (vg_opt-lv_opt), the SAME filesystem that holds a
-- third party's Kafka log directory, and the pre-flight VM snapshot was WAIVED. An
-- unbounded metric store filling this volume has NO rollback. Retention is therefore
-- configured before the first row is ever written, not after.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Generic metric table for the LibreNMS -> TSDB write path (ADR 0005 rev 2).
-- LibreNMS's Graphite/InfluxDB-style writers land measurements here via the
-- application-level writer; the schema is deliberately narrow and typed.
CREATE TABLE IF NOT EXISTS nms_metrics (
  time        TIMESTAMPTZ      NOT NULL,
  device      TEXT             NOT NULL,
  measurement TEXT             NOT NULL,
  field       TEXT             NOT NULL,
  value       DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('nms_metrics', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS nms_metrics_device_time_idx
  ON nms_metrics (device, time DESC);
CREATE INDEX IF NOT EXISTS nms_metrics_measurement_time_idx
  ON nms_metrics (measurement, time DESC);

-- 14-day retention (POC window from the plan's retention table: 14-30 days).
-- This is the control that bounds disk growth on a shared volume.
SELECT add_retention_policy('nms_metrics', INTERVAL '14 days', if_not_exists => TRUE);
