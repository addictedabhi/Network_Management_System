'use client';

/**
 * Alert state-transition timeline for a single alarm (Phase 3 a / N1). Reads
 * `GET /api/v1/alarms/:id/history`, which LibreNMS scopes to the alarm's device and pages
 * server-side with a real total. Four DISTINCT states: loading / error / empty / success. At POC
 * the timeline is genuinely SHORT (2 alarms, 3 rules) — a short-but-real timeline, not fabricated
 * and not the empty state.
 */
import type { AlertLogEntry } from '@nms/shared';
import { DataState } from '../DataState';
import { useBffQuery } from '../../hooks/useBffQuery';
import { bffClient } from '../../lib/bffClient';
import { relativeAge } from '../../lib/format';

export interface AlarmHistoryTimelineProps {
  readonly alarmId: string;
}

/**
 * Map a LibreNMS alert lifecycle state code to an icon + label (NFR-30: never colour alone). The
 * codes: 0 = recovered/ok, 1 = alerting, 2 = acknowledged, 3 = worse. Unknown codes stay neutral.
 */
function stateMeta(state: number | null): { label: string; glyph: string; tone: string } {
  switch (state) {
    case 0:
      return { label: 'Recovered', glyph: '✓', tone: 'ok' };
    case 1:
      return { label: 'Raised', glyph: '▲', tone: 'danger' };
    case 2:
      return { label: 'Acknowledged', glyph: '☑', tone: 'muted' };
    case 3:
      return { label: 'Worsened', glyph: '▲', tone: 'warning' };
    default:
      return { label: 'Transition', glyph: '•', tone: 'muted' };
  }
}

export function AlarmHistoryTimeline({ alarmId }: AlarmHistoryTimelineProps) {
  const { status, data, errorCode, reload } = useBffQuery<{ data: readonly AlertLogEntry[] }>(
    () => bffClient.getAlarmHistory(alarmId, 'perPage=50'),
    (r) => r.data.length === 0,
    [alarmId]
  );

  return (
    <DataState
      status={status}
      errorCode={errorCode}
      onRetry={reload}
      emptyMessage="No recorded state transitions for this alarm yet."
    >
      {() => (
        <ol className="timeline" aria-label="Alarm state-transition history">
          {data!.data.map((e) => {
            const meta = stateMeta(e.state);
            return (
              <li key={e.id} className="timeline__item">
                <span className={`timeline__glyph sev sev--${meta.tone}`} aria-hidden="true">
                  {meta.glyph}
                </span>
                <div className="timeline__body">
                  <span className="timeline__label">{meta.label}</span>
                  {e.detail ? <span className="timeline__detail">{e.detail}</span> : null}
                  <span className="timeline__time" title={e.loggedAt}>
                    {relativeAge(e.loggedAt)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </DataState>
  );
}
