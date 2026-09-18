'use client';
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ArrowRight,
  Check,
  Clock3,
  ShieldX,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { Activity, AppData } from '@/lib/types';
import { relative } from '@/lib/api';
import { Badge, Empty, PageHeading, SearchInput } from './common';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
export function ActivityPage({ data, onPlayground }: { data: AppData; onPlayground: () => void }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Activity | null>(null);
  const filtered = data.activity.filter(
    (a) =>
      (filter === 'all' || a.status === filter) &&
      `${a.tool_name} ${a.connection_name} ${a.client_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const successful = data.activity.filter((a) => a.status === 'success').length;
  const average = data.activity.length
    ? Math.round(data.activity.reduce((s, a) => s + a.duration_ms, 0) / data.activity.length)
    : 0;
  function download() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mack-activity.json';
    link.click();
    URL.revokeObjectURL(url);
    data.notify('Activity exported');
  }
  return (
    <>
      <PageHeading
        eyebrow="NOTHING LOST IN TRANSLATION"
        title="A clear view of every action."
        description="See what your AI accessed, what it did, and how it went."
        action={
          <Button variant="secondary" disabled={!filtered.length} onClick={download}>
            <ArrowDownToLine size={16} />
            Export activity
          </Button>
        }
      />
      <div className="metric-grid">
        <div>
          <span>Tool calls</span>
          <strong>
            {data.activity.length}
            <small>most recent 200</small>
          </strong>
        </div>
        <div>
          <span>Success rate</span>
          <strong>
            {data.activity.length
              ? `${Math.round((successful / data.activity.length) * 100)}%`
              : '—'}
            <small>across your calls</small>
          </strong>
        </div>
        <div>
          <span>Average duration</span>
          <strong>
            {average || '—'}
            <small>{average ? 'milliseconds' : 'No calls yet'}</small>
          </strong>
        </div>
      </div>
      <div className="section-toolbar">
        <div className="tabs">
          {['all', 'success', 'error', 'denied'].map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All activity' : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search activity…" />
      </div>
      {filtered.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Client</th>
                <th>Status</th>
                <th>Duration</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} onClick={() => setSelected(a)}>
                  <td>
                    <button className="table-action" onClick={() => setSelected(a)}>
                      <span className={`action-icon ${a.status}`}>
                        {a.status === 'success' ? (
                          <Check size={15} />
                        ) : a.status === 'denied' ? (
                          <ShieldX size={15} />
                        ) : (
                          <X size={15} />
                        )}
                      </span>
                      <span>
                        <strong>{a.tool_name}</strong>
                        <small>
                          {a.connection_name}
                          {a.connection_id?.startsWith('demo_') ? ' · Demo' : ''}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>{a.client_name}</td>
                  <td>
                    <Badge
                      color={
                        a.status === 'success' ? 'green' : a.status === 'denied' ? 'amber' : 'red'
                      }
                    >
                      {a.status}
                    </Badge>
                  </td>
                  <td className="tabular">{a.duration_ms} ms</td>
                  <td className="muted">{relative(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={<ActivityIcon size={28} />}
          title={
            search || filter !== 'all'
              ? 'No matching activity'
              : 'Your story is just getting started'
          }
          description={
            search || filter !== 'all'
              ? 'Try another filter or search term.'
              : 'Every tool call appears here. Try a connection in the playground to see your first one.'
          }
          action={
            <Button variant="secondary" onClick={onPlayground}>
              Try the playground <ArrowRight size={15} />
            </Button>
          }
        />
      )}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="A closer look"
        description="Tool call details and redacted arguments."
      >
        {selected && (
          <>
            <dl className="details-list">
              {[
                ['Tool', selected.tool_name],
                ['Connection', selected.connection_name],
                ['Client', selected.client_name],
                ['User', selected.user_name],
                ['Status', selected.status],
                ['Duration', `${selected.duration_ms} ms`],
                ['Timestamp', new Date(selected.created_at).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <h3 className="small-heading">Arguments</h3>
            <pre className="code-block">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(selected.arguments), null, 2);
                } catch {
                  return selected.arguments;
                }
              })()}
            </pre>
            {selected.error && <div className="error-message">{selected.error}</div>}
          </>
        )}
      </Modal>
    </>
  );
}
