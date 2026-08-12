-- =============================================================================
-- AIRNMS / LibreNMS dashboard seed - human-authored operator dashboards
-- =============================================================================
-- Purpose:  Idempotently recreate the human-authored LibreNMS dashboards (and
--           their widgets) on a FRESH deploy, so a rebuilt stack comes up with
--           the operator dashboards already present.
--
-- Captured from the live nms-db (MariaDB) on 10.121.77.206, 2026-08-12,
-- READ-ONLY (SELECT only). Three human-authored dashboards were captured, all
-- owned by user_id=5 (username 'nms-testeng', auth_type sso):
--     dashboard_id=4 "NOC Triage"                                 - 8 widgets
--     dashboard_id=6 "Executive Service Overview"                 - 6 widgets
--     dashboard_id=7 "L3 Engineer - Radio, Transport & Platform"  - 13 widgets
-- The stock empty "Default" dashboards (id 1/2, owned by deprovisioned/absent
-- users) are intentionally NOT captured - LibreNMS creates them per user.
--
-- The captured user_id is NOT reproduced here - user_ids differ per install;
-- the target user is resolved BY USERNAME at run time (see @target_username).
-- All three dashboards share the same owner, so a single @target_username
-- parameter attaches all three. If a future capture finds dashboards owned by
-- different users, split them into separate seed files (one per owner) or add a
-- per-dashboard username variable.
--
-- Schema (LibreNMS 25.7.0 - verified against the live DB, DO NOT assume):
--   dashboards(dashboard_id PK auto_inc, user_id, dashboard_name, access)
--   users_widgets(user_widget_id PK auto_inc, user_id, widget varchar(32),
--                 col, row, size_x, size_y, title varchar(255), refresh,
--                 settings text, dashboard_id)
--   NOTE the table is `users_widgets` (plural users), NOT `user_widgets`.
--   `settings` holds PHP json_encode() output (forward slashes escaped as \/,
--    HTML entities like &gt;/&lt; stored literally). To store the literal \/
--    that PHP produced, this file writes \\/ in SQL string literals so MariaDB's
--    string parser yields \/. Likewise \\" -> stored \" (the L3 Notes contains
--    an escaped quoted string). A widget with NO config stores the literal
--    2-char string  ""  (verified HEX 2222 on the live DB), NOT a zero-length
--    string - so this file writes '""', not ''. Every value is byte-for-byte
--    identical to the live capture (verified by per-widget MD5 against the DB).
--
-- Idempotency (per dashboard, independently):
--   * Runs inside a single transaction.
--   * Each dashboard row is INSERTed only if (user_id, dashboard_name) is
--     absent (existence-guarded), then its id is resolved into a variable.
--   * Each dashboard's widgets are DELETEd (scoped to THAT dashboard_id) then
--     re-INSERTed from the captured set - so re-running produces EXACTLY the
--     captured widgets with no duplication and no drift. Only rows for the
--     seeded dashboards are touched; no other dashboard or user is affected.
--
-- Target-user assumption:
--   The dashboards are attached to the user whose username = @target_username.
--   Default 'nms-testeng' (the SSO-provisioned NOC engineer these were authored
--   for). Override at run time, e.g.:
--     mariadb ... -e "SET @target_username='some-other-user';" \
--                 ... < seed_dashboards.sql
--   or edit the SET line below. If that username does not exist, the seed
--   ABORTS with a clear error and writes nothing (fail-closed - never orphan a
--   dashboard on a non-existent user / FK-invalid user_id).
-- =============================================================================

-- ---- Parameters -------------------------------------------------------------
-- Override before sourcing this file if the target user differs.
SET @target_username = IFNULL(@target_username, 'nms-testeng');

START TRANSACTION;

-- ---- Resolve target user by USERNAME (portable across installs) --------------
SET @target_user_id = (SELECT user_id FROM users WHERE username = @target_username LIMIT 1);

-- Fail-closed on a missing target user, WITHOUT a stored routine (this file is
-- sourced by the mariadb CLI, which does not accept top-level compound blocks /
-- SIGNAL). Two layers guarantee nothing is orphaned:
--   1. The runner (run_seed.sh) resolves the username FIRST and ABORTS before
--      sourcing this file if it is absent - the primary, loud guard.
--   2. Defence in depth here: every write below is gated on
--      `@target_user_id IS NOT NULL`, so if this file is ever sourced directly
--      with a bad username it is a safe NO-OP (writes zero rows) rather than
--      inserting a dashboard against user_id 0 / a non-existent user_id.
-- The trailing diagnostic SELECT makes a missing user impossible to miss.


-- =============================================================================
-- DASHBOARD 1 of 3: "NOC Triage" (8 widgets, access=1 shared)
-- =============================================================================
SET @dashboard_name   = 'NOC Triage';
SET @dashboard_access = 1;

INSERT INTO dashboards (user_id, dashboard_name, access)
SELECT @target_user_id, @dashboard_name, @dashboard_access
FROM DUAL
WHERE @target_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dashboards
    WHERE user_id = @target_user_id AND dashboard_name = @dashboard_name
  );

SET @dash_id = (
  SELECT dashboard_id FROM dashboards
  WHERE user_id = @target_user_id AND dashboard_name = @dashboard_name
  ORDER BY dashboard_id LIMIT 1
);

DELETE FROM users_widgets WHERE @dash_id IS NOT NULL AND dashboard_id = @dash_id;

INSERT INTO users_widgets
  (user_id, dashboard_id, widget, col, row, size_x, size_y, refresh, title, settings)
SELECT * FROM (
  SELECT @target_user_id AS uid, @dash_id AS did, 'alerts' AS w,
         1 AS c, 1 AS r, 13 AS sx, 3 AS sy, 60 AS rf, 'Alerts' AS t, '""' AS st UNION ALL
  SELECT @target_user_id, @dash_id, 'device-summary-horiz', 14, 1,  7, 3, 60, 'Device Summary Horizontal', '""' UNION ALL
  SELECT @target_user_id, @dash_id, 'availability-map',      1,  4,  7, 3, 60, 'Availability Map', '""' UNION ALL
  SELECT @target_user_id, @dash_id, 'top-devices',           8,  4,  7, 3, 60, 'Top Devices', '""' UNION ALL
  SELECT @target_user_id, @dash_id, 'top-errors',           15,  4,  6, 3, 60, 'Top Errors', '""' UNION ALL
  SELECT @target_user_id, @dash_id, 'alertlog',              1,  7, 10, 4, 60, 'Alert History', '""' UNION ALL
  SELECT @target_user_id, @dash_id, 'alertlog-stats',       11,  7, 10, 4, 60, 'Alert History Stats', '""' UNION ALL
  SELECT @target_user_id, @dash_id, 'notes',                 1, 11, 20, 4, 60, 'Notes',
   '{"title":"Triage Runbook","notes":"<h4>Triage order<\\/h4><ol><li>Alerts panel first - unacked criticals before anything else.<\\/li><li>Availability Map - is it one device or many? Many = upstream\\/transport, one = the device.<\\/li><li>Alert History - new event or a flap that has happened before?<\\/li><li>Eventlog - what changed just before it broke?<\\/li><li>ACK with a note before you escalate, so the next shift is not re-diagnosing it.<\\/li><\\/ol><h4>Escalation<\\/h4><ul><li>L1 NOC -> L2 Network Engineering -> Duty Manager<\\/li><li>Contacts: TBD - fill in before go-live.<\\/li><\\/ul><p><b>WARNING:<\\/b> no alert transports are configured in AIRNMS. Alerts appear on this dashboard and nowhere else - no email, no chat, no page. Someone must be watching this screen.<\\/p>","refresh":"60"}'
) AS captured_widgets
WHERE @dash_id IS NOT NULL;


-- =============================================================================
-- DASHBOARD 2 of 3: "Executive Service Overview" (6 widgets, access=1 shared)
-- =============================================================================
SET @dashboard_name   = 'Executive Service Overview';
SET @dashboard_access = 1;

INSERT INTO dashboards (user_id, dashboard_name, access)
SELECT @target_user_id, @dashboard_name, @dashboard_access
FROM DUAL
WHERE @target_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dashboards
    WHERE user_id = @target_user_id AND dashboard_name = @dashboard_name
  );

SET @dash_id = (
  SELECT dashboard_id FROM dashboards
  WHERE user_id = @target_user_id AND dashboard_name = @dashboard_name
  ORDER BY dashboard_id LIMIT 1
);

DELETE FROM users_widgets WHERE @dash_id IS NOT NULL AND dashboard_id = @dash_id;

INSERT INTO users_widgets
  (user_id, dashboard_id, widget, col, row, size_x, size_y, refresh, title, settings)
SELECT * FROM (
  SELECT @target_user_id AS uid, @dash_id AS did, 'device-summary-horiz' AS w,
         1 AS c, 1 AS r, 20 AS sx, 3 AS sy, 60 AS rf, 'Device Summary Horizontal' AS t,
         '{"title":"Service Health Summary","refresh":60}' AS st UNION ALL
  SELECT @target_user_id, @dash_id, 'availability-map',  1,  4,  6, 3, 60, 'Availability Map',
         '{"title":"Device Availability","refresh":60}' UNION ALL
  SELECT @target_user_id, @dash_id, 'alerts',            7,  4, 14, 4, 60, 'Alerts',
         '{"title":"Open Issues","refresh":60}' UNION ALL
  SELECT @target_user_id, @dash_id, 'alertlog-stats',    1,  8, 10, 4, 60, 'Alert History Stats',
         '{"title":"Most Frequent Issues","refresh":300}' UNION ALL
  SELECT @target_user_id, @dash_id, 'top-devices',      11,  8, 10, 4, 60, 'Top Devices',
         '{"title":"Busiest Devices","refresh":300}' UNION ALL
  SELECT @target_user_id, @dash_id, 'notes',             1, 12, 20, 4, 60, 'Notes',
   '{"title":"Service Summary","refresh":600,"notes":"<h4>Scope<\\/h4><ul><li>7 devices in NMS-POC-Lab \\/ Demo Lab Rack 1: 1 switch, 1 router, 2 AF60 radio links, 2 Linux hosts, 1 NMS self-monitor. 32 interfaces, polled every 5 minutes.<\\/li><\\/ul><h4>How to read this page<\\/h4><ul><li><b>Service Health Summary<\\/b> - headline counts. Down greater than 0 means something is out of service right now.<\\/li><li><b>Device Availability<\\/b> - one tile per device. All green = full service.<\\/li><li><b>Open Issues<\\/b> - currently alarming and not yet acknowledged. Empty is the target state.<\\/li><li><b>Most Frequent Issues<\\/b> - which rules fire most often. Use it to spot chronic problems, not incidents.<\\/li><\\/ul><h4>What is alarmed today<\\/h4><ul><li>Device unreachable - Critical<\\/li><li>CPU at or above 85 percent - Warning<\\/li><li>Radio RSSI at or below -65 dBm - Warning<\\/li><li>Recovery and acknowledgement notifications are enabled on all three rules.<\\/li><\\/ul><h4>Known limitations - read before drawing conclusions<\\/h4><ul><li><b>Notification transports are NOT configured.<\\/b> Alerts are visible in this portal only - no email, chat or paging path.<\\/li><li>Service checks: 0 configured. The Services column will read zero.<\\/li><li>5 of 7 devices are simulated. Trend and uptime figures reflect synthetic data, not production behaviour.<\\/li><li>Uptime percent, SLA and MTTR are not available as native panels here. They are published on the separate KPI page.<\\/li><li>172.16.10.22 flaps between up and down. It is a lab artefact, not a service outage.<\\/li><\\/ul><h4>Last reviewed: 12 August 2026<\\/h4>"}'
) AS captured_widgets
WHERE @dash_id IS NOT NULL;


-- =============================================================================
-- DASHBOARD 3 of 3: "L3 Engineer - Radio, Transport & Platform"
--                   (13 widgets, access=1 shared)
-- NOTE: generic-graph widgets reference graph_device by NUMERIC device_id
--       (5/6/7 = sim-radio-01/sim-radio-02/NMS host on the CAPTURED install).
--       Device ids, like user ids, differ per install; on a fresh deploy these
--       graphs resolve to whatever device holds that id. This is a captured
--       property of the source dashboard, preserved byte-for-byte; retargeting
--       to per-install device ids is out of scope for a data-faithful seed.
-- =============================================================================
SET @dashboard_name   = 'L3 Engineer - Radio, Transport & Platform';
SET @dashboard_access = 1;

INSERT INTO dashboards (user_id, dashboard_name, access)
SELECT @target_user_id, @dashboard_name, @dashboard_access
FROM DUAL
WHERE @target_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dashboards
    WHERE user_id = @target_user_id AND dashboard_name = @dashboard_name
  );

SET @dash_id = (
  SELECT dashboard_id FROM dashboards
  WHERE user_id = @target_user_id AND dashboard_name = @dashboard_name
  ORDER BY dashboard_id LIMIT 1
);

DELETE FROM users_widgets WHERE @dash_id IS NOT NULL AND dashboard_id = @dash_id;

INSERT INTO users_widgets
  (user_id, dashboard_id, widget, col, row, size_x, size_y, refresh, title, settings)
SELECT * FROM (
  SELECT @target_user_id AS uid, @dash_id AS did, 'alerts' AS w,
         1 AS c, 1 AS r, 13 AS sx, 4 AS sy, 60 AS rf, 'Alerts' AS t,
         '{"title":"Active Alerts","refresh":60}' AS st UNION ALL
  SELECT @target_user_id, @dash_id, 'alertlog-stats', 14,  1,  7, 4, 60, 'Alert History Stats',
         '{"title":"Repeat Offenders","refresh":300}' UNION ALL
  SELECT @target_user_id, @dash_id, 'generic-graph',   1,  5,  7, 4, 60, 'Graph',
         '{"title":"sim-radio-01 - RSSI","refresh":300,"graph_type":"device_wireless_rssi","graph_device":"5","graph_range":"day","graph_legend":"yes"}' UNION ALL
  SELECT @target_user_id, @dash_id, 'generic-graph',   8,  5,  7, 4, 60, 'Graph',
         '{"title":"sim-radio-02 - RSSI","refresh":300,"graph_type":"device_wireless_rssi","graph_device":"6","graph_range":"day","graph_legend":"yes"}' UNION ALL
  SELECT @target_user_id, @dash_id, 'generic-graph',  15,  5,  6, 4, 60, 'Graph',
         '{"title":"sim-radio-01 - SNR","refresh":300,"graph_type":"device_wireless_snr","graph_device":"5","graph_range":"day","graph_legend":"yes"}' UNION ALL
  SELECT @target_user_id, @dash_id, 'generic-graph',   1,  9,  7, 4, 60, 'Graph',
         '{"title":"sim-radio-02 - SNR","refresh":300,"graph_type":"device_wireless_snr","graph_device":"6","graph_range":"day","graph_legend":"yes"}' UNION ALL
  SELECT @target_user_id, @dash_id, 'generic-graph',   8,  9,  7, 4, 60, 'Graph',
         '{"title":"sim-radio-01 - Tx\\/Rx Rate","refresh":300,"graph_type":"device_wireless_rate","graph_device":"5","graph_range":"day","graph_legend":"yes"}' UNION ALL
  SELECT @target_user_id, @dash_id, 'top-errors',     15,  9,  6, 4, 60, 'Top Errors',
         '{"title":"Interface Errors \\/ Discards","refresh":300}' UNION ALL
  SELECT @target_user_id, @dash_id, 'generic-graph',   1, 13,  7, 4, 60, 'Graph',
         '{"title":"Poller Performance - NMS host","refresh":300,"graph_type":"device_poller_perf","graph_device":"7","graph_range":"day","graph_legend":"yes"}' UNION ALL
  SELECT @target_user_id, @dash_id, 'generic-graph',   8, 13,  7, 4, 60, 'Graph',
         '{"title":"ICMP Latency - NMS host","refresh":300,"graph_type":"device_ping_perf","graph_device":"7","graph_range":"day","graph_legend":"yes"}' UNION ALL
  SELECT @target_user_id, @dash_id, 'top-interfaces',  15, 13,  6, 4, 60, 'Top Interfaces',
         '{"title":"Busiest Interfaces","refresh":300}' UNION ALL
  SELECT @target_user_id, @dash_id, 'syslog',           1, 17, 20, 4, 60, 'Syslog',
         '{"title":"Syslog","refresh":300}' UNION ALL
  SELECT @target_user_id, @dash_id, 'notes',            1, 21, 20, 5, 60, 'Notes',
   '{"title":"L3 Reference","refresh":600,"notes":"<h4>Alert thresholds in force<\\/h4><ul><li>Device down: devices.status = 0 - Critical, 300s delay, 300s interval<\\/li><li>High CPU: processors.processor_usage &gt;= 85 - Warning, 300s \\/ 300s<\\/li><li>Radio RSSI: wireless_sensors.sensor_class = rssi AND sensor_current &lt;= -65 - Warning, 300s \\/ 300s<\\/li><li>Recovery and acknowledgement alerts are ON for all three.<\\/li><\\/ul><h4>Radio baseline (measured 11 Aug 2026)<\\/h4><ul><li>sim-radio-01: local RSSI -54 dBm, remote -52 dBm, SNR 34\\/33 dB, 1.8 Gbps Tx\\/Rx, 60.48 GHz, 1.2 km link.<\\/li><li>The -65 dBm threshold leaves about 11 dB of headroom.<\\/li><li>Values are perfectly flat because the radios are simulated. Re-baseline against real hardware before trusting the threshold.<\\/li><\\/ul><h4>Known-broken \\/ known-noisy - do not chase these<\\/h4><ul><li>\\/eventlog global view returns \\"No results found!\\" while per-device event data exists. Broken view, not missing data.<\\/li><li>172.16.10.22 (device 2) flaps up and down and was never polled properly over SNMP. Standing noise, not a real outage.<\\/li><li>sim-switch-01 Gi0\\/21-24 (uplink-21..24) down 14+ days, never up since the sim was built. There is still NO port-state alert rule.<\\/li><li>Alert History before 11 Aug 12:00 is the rule-attachment burst, not real operational history.<\\/li><li>Syslog entries are seeded test data (NMSATTRIB attrib-proof-*), not live device logs.<\\/li><li>The NMS host (device 7) is ICMP-only. No SNMP, so no CPU \\/ memory \\/ disk graphs exist for it.<\\/li><\\/ul><h4>If the poller falls behind, every other dashboard is quietly lying<\\/h4><ul><li>Check Poller Performance first whenever data looks stale.<\\/li><\\/ul><h4>Escalation<\\/h4><ul><li>L1 NOC to L2 Network Engineering to L3 to Duty Manager. Contacts TBD before go-live.<\\/li><\\/ul>"}'
) AS captured_widgets
WHERE @dash_id IS NOT NULL;


COMMIT;

-- ---- Post-conditions (informational / loud on failure) ----------------------
-- @dash_id holds the LAST seeded dashboard (dashboard 3). The per-dashboard
-- widget counts below confirm all three were seeded.
SELECT CASE WHEN @target_user_id IS NULL
            THEN CONCAT('ABORTED: username ''', @target_username,
                        ''' not found in users - NO ROWS WRITTEN')
            ELSE 'OK' END                                          AS seed_status,
       @target_user_id                                            AS target_user_id,
       @target_username                                           AS target_username;

SELECT d.dashboard_id,
       d.dashboard_name,
       (SELECT COUNT(*) FROM users_widgets w WHERE w.dashboard_id = d.dashboard_id) AS widget_count
FROM dashboards d
WHERE d.user_id = @target_user_id
  AND d.dashboard_name IN ('NOC Triage',
                           'Executive Service Overview',
                           'L3 Engineer - Radio, Transport & Platform')
ORDER BY d.dashboard_id;
