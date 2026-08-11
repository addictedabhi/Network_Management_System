'use client';

/**
 * Device detail — identity, reachability, uptime (via <MetricValueCell>), and the paginated
 * interface list (FR-39). Every data region is wrapped in <DataState> (FR-43).
 */
import { use } from 'react';
import { AuthedShell } from '../../../components/AuthedShell';
import { DataState } from '../../../components/DataState';
import { MetricValueCell } from '../../../components/MetricValueCell';
import { AdminPortalLink } from '../../../components/AdminPortalLink';
import { DeviceInterfacesPanel } from '../../../components/DeviceInterfacesPanel';
import { useBffQuery } from '../../../hooks/useBffQuery';
import { bffClient } from '../../../lib/bffClient';
import type { Device } from '@nms/shared';

function DetailView({ id, canOpenAdminPortal }: { id: string; canOpenAdminPortal: boolean }) {
  const device = useBffQuery<Device>(() => bffClient.getDevice(id), () => false, [id]);

  return (
    <>
      <h1>Device Detail</h1>
      <div className="toolbar">
        <AdminPortalLink canOpenAdminPortal={canOpenAdminPortal} deviceId={id} />
      </div>

      <DataState status={device.status} errorCode={device.errorCode} onRetry={device.reload}>
        {() => {
          const d = device.data!;
          return (
            <div className="card" style={{ marginBottom: '1.25rem' }}>
              <p>
                <strong>{d.displayName}</strong> ({d.hostname})
              </p>
              <p>Type: {d.kind}</p>
              <p>Location: {d.location ?? '—'}</p>
              <p>Reachability: <span className={`reach reach--${d.reachability}`}>{d.reachability}</span></p>
              <p>
                Uptime: <MetricValueCell metric={d.uptimeSeconds} unit="s" />
              </p>
            </div>
          );
        }}
      </DataState>

      <DeviceInterfacesPanel id={id} />
    </>
  );
}

export default function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AuthedShell>
      {(session) => <DetailView id={id} canOpenAdminPortal={session.canOpenAdminPortal} />}
    </AuthedShell>
  );
}
