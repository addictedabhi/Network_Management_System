'use client';

/**
 * The device-detail Interfaces panel (FR-39). Wrapped in <DataState> so it renders EXPLICIT
 * loading / error / empty / success states (FR-43), with the three kept DISTINCT: a device with no
 * interfaces (e.g. a ping-only host with no SNMP) shows the honest "No interfaces found" empty
 * state — NOT a backend error. A real upstream failure shows the error state with a retry action.
 * The empty vs error distinction is decided upstream: the BFF maps LibreNMS's "No ports found"
 * no-data response to an empty page, so it arrives here as `data.length === 0`, never as a throw.
 */
import { DataState } from './DataState';
import { MetricValueCell } from './MetricValueCell';
import { useBffQuery } from '../hooks/useBffQuery';
import { bffClient } from '../lib/bffClient';
import type { DeviceInterface } from '@nms/shared';

export function DeviceInterfacesPanel({ id }: { id: string }) {
  const interfaces = useBffQuery<{ data: readonly DeviceInterface[] }>(
    () => bffClient.listDeviceInterfaces(id, 'perPage=100'),
    (r) => r.data.length === 0,
    [id]
  );

  return (
    <>
      <h2>Interfaces</h2>
      <DataState
        status={interfaces.status}
        errorCode={interfaces.errorCode}
        onRetry={interfaces.reload}
        emptyMessage="No interfaces available for this device."
      >
        {() => (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Admin</th>
                  <th scope="col">Oper</th>
                  <th scope="col">In rate</th>
                  <th scope="col">Out rate</th>
                </tr>
              </thead>
              <tbody>
                {interfaces.data!.data.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td>{i.adminState}</td>
                    <td>{i.operState}</td>
                    <td>
                      <MetricValueCell metric={i.inOctetsRate} unit="Bps" />
                    </td>
                    <td>
                      <MetricValueCell metric={i.outOctetsRate} unit="Bps" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
    </>
  );
}
