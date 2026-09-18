'use client';
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Globe,
  Grid2X2,
  Link2,
  List,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Unplug,
  Users,
  X,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { AppData, Connection } from '@/lib/types';
import { api, copy, mutate } from '@/lib/api';
import {
  Badge,
  Empty,
  ErrorMessage,
  Mark,
  PageHeading,
  ProviderIcon,
  SearchInput,
  Submit,
  Toggle,
  useAction,
} from './common';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
const descriptions: Record<string, string> = {
  github: 'Your code, issues, and pull requests.',
  slack: 'The conversations that move work forward.',
  notion: 'A home for your team’s knowledge.',
  linear: 'Projects and issues, always in the loop.',
  gmail: 'Your inbox, a little more connected.',
  drive: 'Every file, right where you need it.',
  custom: 'Your tools, connected through MCP.',
};
const catalog = [
  { id: 'github', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/' },
  { id: 'slack', name: 'Slack', url: 'https://mcp.slack.com/mcp' },
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp' },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp' },
  { id: 'custom', name: 'Custom MCP server', url: '' },
];
export function Connections({ data, onClients }: { data: AppData; onClients: () => void }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState('grid');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const available = data.connections.filter(
    (c) => c.scope === 'personal' || c.workspace_id === data.workspace,
  );
  const filtered = available.filter(
    (c) =>
      (filter === 'all' || c.scope === filter) &&
      `${c.name} ${c.provider}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedConnection = data.connections.find((c) => c.id === selected);
  const connected = available.filter((c) => c.status === 'connected').length;
  const tools = available.flatMap((c) =>
    c.status === 'connected' ? c.tools.filter((t) => t.enabled) : [],
  ).length;
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE MORE CONNECTED"
        title="Your tools. One place."
        description="Connect your world once. Bring it to every AI you use."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus size={17} />
            Add connection
          </Button>
        }
      />
      <div className="connection-overview">
        <div className="overview-copy">
          <div className="small-label">
            <span className="live-dot" />
            YOUR WORLD, IN SYNC
          </div>
          <h2>
            Good things happen
            <br />
            when things connect.
          </h2>
          <p>
            From your first idea to your next big thing.
            <br />
            Your tools are ready when you are.
          </p>
          <button className="text-link" onClick={onClients}>
            Connect an AI client <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="connection-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-line line-one" />
          <div className="art-line line-two" />
          <div className="art-line line-three" />
          <div className="art-line line-four" />
          <div className="art-center">
            <Mark size={44} />
          </div>
          <div className="art-node node-one">
            <ProviderIcon provider="github" size={48} />
          </div>
          <div className="art-node node-two">
            <ProviderIcon provider="slack" size={44} />
          </div>
          <div className="art-node node-three">
            <ProviderIcon provider="notion" size={48} />
          </div>
          <div className="art-node node-four">
            <ProviderIcon provider="linear" size={42} />
          </div>
          <span className="art-spark spark-one">✦</span>
          <span className="art-spark spark-two">✦</span>
          <span className="art-caption">A world of tools. A single connection.</span>
        </div>
        <div className="overview-stats">
          <div>
            <strong>{connected.toString().padStart(2, '0')}</strong>
            <span>Active connections</span>
            <Link2 size={17} />
          </div>
          <div>
            <strong>{tools.toString().padStart(2, '0')}</strong>
            <span>Enabled tools</span>
            <Code2 size={17} />
          </div>
          <div>
            <strong>
              {data.clients
                .filter((c) => !c.revoked_at)
                .length.toString()
                .padStart(2, '0')}
            </strong>
            <span>AI clients</span>
            <BoxesIcon />
          </div>
        </div>
      </div>
      <div className="section-toolbar">
        <div className="tabs">
          {[
            ['all', 'All connections'],
            ['workspace', 'Workspace'],
            ['personal', 'Personal'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>{available.filter((c) => value === 'all' || c.scope === value).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <SearchInput value={search} onChange={setSearch} placeholder="Search connections…" />
          <div className="view-switch">
            <button
              aria-label="Grid view"
              className={layout === 'grid' ? 'active' : ''}
              onClick={() => setLayout('grid')}
            >
              <Grid2X2 size={16} />
            </button>
            <button
              aria-label="List view"
              className={layout === 'list' ? 'active' : ''}
              onClick={() => setLayout('list')}
            >
              <List size={17} />
            </button>
          </div>
        </div>
      </div>
      {filtered.length ? (
        <div className={`connection-grid ${layout === 'list' ? 'connection-list' : ''}`}>
          {filtered.map((c) => (
            <button key={c.id} className="connection-card" onClick={() => setSelected(c.id)}>
              <div className="card-top">
                <ProviderIcon provider={c.provider} />
                <Badge>
                  {c.scope === 'personal' ? <LockKeyhole size={11} /> : <Users size={11} />}{' '}
                  {c.scope === 'personal'
                    ? 'Personal'
                    : data.session.workspaces.find((w) => w.id === c.workspace_id)?.name}
                </Badge>
              </div>
              <div className="card-body">
                <h3>
                  {c.name}
                  <ArrowUpRight size={15} />
                </h3>
                <p>{descriptions[c.provider] || descriptions.custom}</p>
              </div>
              <div className="card-bottom">
                <span className={`connection-status status-${c.status}`}>
                  <span />
                  {c.status === 'connected'
                    ? 'Connected'
                    : c.status === 'paused'
                      ? 'Paused'
                      : 'Needs attention'}
                  {c.is_demo ? <em>Demo</em> : null}
                </span>
                <span className="card-tools">
                  {c.tools.filter((t) => t.enabled).length} tools <ChevronRight size={14} />
                </span>
              </div>
            </button>
          ))}
          <button className="add-card" onClick={() => setAdding(true)}>
            <span>
              <Plus size={22} />
            </span>
            <strong>Make another connection</strong>
            <p>Your next tool is one click away.</p>
          </button>
        </div>
      ) : (
        <Empty
          icon={<SearchIcon />}
          title={search ? 'No connections found' : 'A connected world starts here'}
          description={
            search
              ? 'Try a different name or clear your filters.'
              : 'Add your first MCP server to make its tools available to your AI clients.'
          }
          action={
            <Button variant="secondary" onClick={() => (search ? setSearch('') : setAdding(true))}>
              {search ? 'Clear search' : 'Add connection'}
            </Button>
          }
        />
      )}
      <div className="privacy-note">
        <ShieldCheck size={16} />
        <span>Personal stays personal. You’re always in control of what you share.</span>
        <button onClick={() => setFilter('personal')}>
          View personal connections <ArrowRight size={14} />
        </button>
      </div>
      <div className="endpoint-banner">
        <span className="endpoint-icon">
          <Link2 size={21} />
        </span>
        <div>
          <h3>One endpoint. Endless possibilities.</h3>
          <p>Bring all your connections to your favorite AI client.</p>
        </div>
        <code>{data.session.gatewayUrl.replace('http://', '').replace('https://', '')}</code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => copy(data.session.gatewayUrl, data.notify)}
        >
          <Copy size={14} />
          Copy endpoint
        </Button>
      </div>
      <AddConnection open={adding} onClose={() => setAdding(false)} data={data} />
      {selectedConnection && (
        <ConnectionDetail
          connection={selectedConnection}
          onClose={() => setSelected(null)}
          data={data}
        />
      )}
    </>
  );
}
function BoxesIcon() {
  return <Globe size={17} />;
}
function SearchIcon() {
  return <SlidersHorizontal size={25} />;
}
export function AddConnection({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: AppData;
}) {
  const [provider, setProvider] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState('personal');
  const [auth, setAuth] = useState('oauth');
  const [oauthScope, setOauthScope] = useState('');
  const [oauthConfig, setOauthConfig] = useState<{
    callbackUrl: string;
    providers: Record<string, { ready: boolean; defaultScope: string; appRequired: boolean }>;
  } | null>(null);
  useEffect(() => {
    if (open)
      api<typeof oauthConfig>('/oauth/providers')
        .then(setOauthConfig)
        .catch(() => setOauthConfig(null));
  }, [open]);
  const oauthProvider = (() => {
    try {
      return oauthConfig?.providers[new URL(url).hostname];
    } catch {
      return undefined;
    }
  })();
  const [credential, setCredential] = useState('');
  const [header, setHeader] = useState('X-API-Key');
  const action = useAction(data.refresh, data.notify);
  const close = () => {
    setProvider(null);
    setCredential('');
    action.setError('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={() => !action.busy && close()}
      title={provider ? 'Make a connection' : 'A little closer to your tools'}
      description={
        provider
          ? 'Connect a remote MCP server. Credentials are encrypted and never shared with your clients.'
          : 'Choose a service, or bring any compatible MCP server.'
      }
    >
      {!provider ? (
        <div className="provider-catalog">
          {catalog.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setProvider(p.id);
                setName(p.name);
                setUrl(p.url);
                setAuth('oauth');
                setOauthScope('');
              }}
            >
              <ProviderIcon provider={p.id} size={40} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.id === 'custom'
                    ? 'Connect using a server URL'
                    : 'Sign in with OAuth or use a token'}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (auth === 'oauth') {
              await action.run(async () => {
                const result = await mutate<{ url: string }>('/oauth/start', 'POST', {
                  name,
                  provider,
                  server_url: url,
                  scope,
                  workspace_id: scope === 'workspace' ? data.workspace : undefined,
                  oauth_scope: oauthScope.trim() || undefined,
                });
                window.location.assign(result.url);
              });
              return;
            }
            if (
              await action.run(
                () =>
                  mutate('/connections', 'POST', {
                    name,
                    provider,
                    scope,
                    workspace_id: scope === 'workspace' ? data.workspace : undefined,
                    server_url: url,
                    auth_type: auth,
                    token: credential || undefined,
                    header: auth === 'api_key' ? header : undefined,
                  }),
                'Connection added and tools discovered',
              )
            )
              close();
          }}
        >
          <div className="scope-picker">
            <button
              type="button"
              className={scope === 'personal' ? 'selected' : ''}
              onClick={() => setScope('personal')}
            >
              <LockKeyhole size={18} />
              <strong>Just me</strong>
              <span>Only you can use it.</span>
              {scope === 'personal' && <Check size={15} />}
            </button>
            <button
              type="button"
              disabled={
                !data.workspace ||
                data.session.workspaces.find((w) => w.id === data.workspace)?.role === 'member'
              }
              className={scope === 'workspace' ? 'selected' : ''}
              onClick={() => setScope('workspace')}
            >
              <Users size={18} />
              <strong>
                {data.session.workspaces.find((w) => w.id === data.workspace)?.name || 'Workspace'}
              </strong>
              <span>Share with your team.</span>
              {scope === 'workspace' && <Check size={15} />}
            </button>
          </div>
          <label className="field">
            Connection name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="My GitHub"
            />
          </label>
          <label className="field">
            MCP server URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              type="url"
              placeholder="https://example.com/mcp"
            />
          </label>
          <label className="field">
            Authentication
            <select value={auth} onChange={(e) => setAuth(e.target.value)}>
              <option value="oauth">OAuth sign-in</option>
              <option value="bearer">Bearer token</option>
              <option value="api_key">API key</option>
              <option value="none">No authentication</option>
            </select>
          </label>
          {auth === 'api_key' && (
            <label className="field">
              Header name
              <input
                value={header}
                onChange={(e) => setHeader(e.target.value)}
                pattern="[Xx]-[a-zA-Z0-9-]+"
                required
              />
            </label>
          )}
          {auth !== 'none' && auth !== 'oauth' && (
            <label className="field">
              {auth === 'bearer' ? 'Bearer token' : 'API key'}
              <input
                type="password"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                required
                autoComplete="off"
                placeholder="Your server credential"
              />
            </label>
          )}
          {auth === 'oauth' && (
            <>
              <label className="field">
                OAuth scopes{' '}
                <input
                  value={oauthScope}
                  onChange={(e) => setOauthScope(e.target.value)}
                  placeholder={oauthProvider?.defaultScope || 'Provider default'}
                />
              </label>
              <p className="form-hint">
                You’ll sign in with the provider, then return to review discovered tools. Linear
                defaults to read-only; other providers use the permissions shown on their consent
                screen.
              </p>
              {oauthProvider?.appRequired && !oauthProvider.ready && (
                <p role="alert" className="form-hint">
                  An administrator must configure this provider’s OAuth app before connecting.
                  Register this callback URL: <code>{oauthConfig?.callbackUrl}</code>
                </p>
              )}
            </>
          )}
          <ErrorMessage error={action.error} />
          <div className="modal-footer">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setProvider(null)}
              disabled={action.busy}
            >
              Back
            </Button>
            <Submit
              busy={action.busy}
              disabled={auth === 'oauth' && oauthProvider?.ready === false}
            >
              {auth === 'oauth' ? 'Continue with OAuth' : 'Connect server'}
            </Submit>
          </div>
        </form>
      )}
    </Modal>
  );
}
function ConnectionDetail({
  connection: c,
  onClose,
  data,
}: {
  connection: Connection;
  onClose: () => void;
  data: AppData;
}) {
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [credential, setCredential] = useState('');
  const action = useAction(data.refresh, data.notify);
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={c.name}
      description="Manage the tools this connection makes available to your AI clients."
    >
      <div className="detail-summary">
        <ProviderIcon provider={c.provider} size={50} />
        <div>
          <div className="flex-line">
            <Badge color={c.status === 'connected' ? 'green' : 'amber'}>{c.status}</Badge>
            {c.is_demo ? <Badge>Local demo server</Badge> : null}
            <Badge>{c.scope}</Badge>
          </div>
          <code>{c.server_url}</code>
        </div>
        {c.canManage && (
          <Button
            variant="secondary"
            size="sm"
            disabled={action.busy}
            onClick={() =>
              action.run(() => mutate(`/connections/${c.id}/sync`, 'POST'), 'Tools refreshed')
            }
          >
            <RefreshCw size={14} className={action.busy ? 'spin' : ''} />
            Refresh tools
          </Button>
        )}
      </div>
      <div className="detail-tool-heading">
        <h3>
          Available tools <span>{c.tools.length}</span>
        </h3>
        <SearchInput value={search} onChange={setSearch} placeholder="Find a tool…" />
      </div>
      <p className="form-hint">
        New and changed tools require review. Jev suggestions never grant access; existing user and
        client permissions still apply.
      </p>
      <div className="tool-list">
        {c.tools
          .filter((t) =>
            `${t.remote_name} ${t.description}`.toLowerCase().includes(search.toLowerCase()),
          )
          .map((t) => (
            <div className="tool-row" key={t.id}>
              <div>
                <div className="flex-line">
                  <code>{t.remote_name}</code>
                  <Badge
                    color={
                      t.risk_level === 'read' ? 'blue' : t.risk_level === 'write' ? 'amber' : 'red'
                    }
                  >
                    {t.risk_level}
                  </Badge>
                </div>
                <p>{t.description}</p>
                <small className="public-name">{t.public_name}</small>
                <p>
                  {t.review_state === 'reviewed' ? 'Reviewed' : 'Review required'} · Jev:{' '}
                  {t.classification_status}
                  {t.suggested_risk ? ` — ${t.suggested_risk}` : ''}
                  {t.classification_probability != null
                    ? ` (${Math.round(t.classification_probability * 100)}% model probability)`
                    : ''}
                </p>
                {t.review_note && (
                  <p>
                    Review: {t.review_note}
                    {t.reviewed_at ? ` · ${t.reviewed_at}` : ''}
                  </p>
                )}
                {c.canManage && (
                  <details className="tool-review">
                    <summary>Review permissions</summary>
                    {!t.definition_hash && <p>Refresh tools to review the current definition.</p>}
                    <p>
                      Confirm the server’s actual behavior. Metadata and model probabilities are not
                      security guarantees.
                    </p>
                    <pre style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(JSON.parse(t.input_schema), null, 2)}
                    </pre>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        action.run(
                          () =>
                            mutate(`/tools/${t.id}/review`, 'POST', {
                              definition_hash: t.definition_hash,
                              risk_level: form.get('risk'),
                              note: form.get('note'),
                              enabled: form.get('enable') === 'on',
                            }),
                          'Tool reviewed',
                        );
                      }}
                    >
                      <label>
                        Approved access level{' '}
                        <select
                          name="risk"
                          defaultValue={t.risk_floor === 'admin' ? 'admin' : 'write'}
                        >
                          <option value="read" disabled={t.risk_floor === 'admin'}>
                            Read
                          </option>
                          <option value="write" disabled={t.risk_floor === 'admin'}>
                            Write
                          </option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                      <label>
                        Review rationale{' '}
                        <input
                          name="note"
                          required
                          minLength={10}
                          maxLength={2000}
                          placeholder="How did you verify the tool’s behavior?"
                        />
                      </label>
                      <label>
                        <input type="checkbox" name="enable" /> Enable after review
                      </label>
                      <Button type="submit" disabled={action.busy || !t.definition_hash}>
                        Approve permissions
                      </Button>
                    </form>
                  </details>
                )}
              </div>
              <Toggle
                label={`Enable ${t.remote_name}`}
                checked={Boolean(t.enabled)}
                disabled={!c.canManage || action.busy || t.review_state !== 'reviewed'}
                onChange={() =>
                  action.run(() => mutate(`/tools/${t.id}`, 'PATCH', { enabled: !t.enabled }))
                }
              />
            </div>
          ))}
        {!c.tools.length && <p className="form-hint">No tools were advertised by this server.</p>}
      </div>
      {c.canManage && c.oauth_provider && (
        <Button
          variant="secondary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              const result = await mutate<{ url: string }>('/oauth/start', 'POST', {
                connection_id: c.id,
                name: c.name,
                provider: c.provider,
                server_url: c.server_url,
                scope: c.scope,
                workspace_id: c.workspace_id || undefined,
              });
              window.location.assign(result.url);
            })
          }
        >
          Reconnect with OAuth
        </Button>
      )}
      {rotating && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(
                () => mutate(`/connections/${c.id}`, 'PATCH', { token: credential }),
                'Credentials updated',
              )
            ) {
              setCredential('');
              setRotating(false);
            }
          }}
        >
          <label className="field">
            New credential
            <input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              required
            />
          </label>
          <Submit busy={action.busy}>Save credential</Submit>
        </form>
      )}
      <ErrorMessage error={action.error} />
      {c.canManage && (
        <div className="detail-footer">
          <Button
            variant="ghost"
            size="sm"
            disabled={action.busy}
            onClick={() =>
              action.run(() =>
                mutate(`/connections/${c.id}`, 'PATCH', {
                  status: c.status === 'paused' ? 'connected' : 'paused',
                }),
              )
            }
          >
            {c.status === 'paused' ? 'Resume connection' : 'Pause connection'}
          </Button>
          {c.auth_type !== 'none' && !c.oauth_provider && (
            <Button variant="ghost" size="sm" onClick={() => setRotating(!rotating)}>
              Update credentials
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            disabled={action.busy}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              if (
                await action.run(
                  () => mutate(`/connections/${c.id}`, 'DELETE'),
                  'Connection removed',
                )
              )
                onClose();
            }}
          >
            <Unplug size={14} />
            {confirmDelete ? 'Confirm disconnect' : 'Disconnect'}
          </Button>
        </div>
      )}
    </Modal>
  );
}
