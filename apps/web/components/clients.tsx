'use client';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  KeyRound,
  Laptop,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { AppData, Client, Permission } from '@/lib/types';
import { copy, mutate, relative } from '@/lib/api';
import { Badge, Empty, ErrorMessage, PageHeading, ProviderIcon, Submit, useAction } from './common';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
export function Clients({ data }: { data: AppData }) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('cursor');
  const [selected, setSelected] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ token: string; endpoint: string } | null>(null);
  const clients = data.clients.filter((c) => !c.revoked_at);
  const current = clients.find((c) => c.id === selected);
  return (
    <>
      <PageHeading
        eyebrow="ASK ANYWHERE"
        title="Meet your AI, everywhere."
        description="One Mack connection brings your tools to the assistants you already love."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus size={17} />
            Add client
          </Button>
        }
      />
      <div className="client-explainer">
        <span className="soft-icon">
          <Laptop size={25} />
        </span>
        <div>
          <h3>Your tools travel with you.</h3>
          <p>Give each client its own key and choose exactly what it can access.</p>
        </div>
        <ShieldCheck size={23} />
      </div>
      <div className="section-heading">
        <h2>
          Your clients <span>{clients.length}</span>
        </h2>
        <span>Keys are shown only once</span>
      </div>
      {clients.length ? (
        <div className="client-list">
          {clients.map((c) => (
            <button className="client-row" key={c.id} onClick={() => setSelected(c.id)}>
              <ProviderIcon provider={c.type} size={44} />
              <div>
                <h3>{c.name}</h3>
                <p>
                  {c.last_used_at
                    ? `Last used ${relative(c.last_used_at)}`
                    : 'Ready for your first request'}
                </p>
              </div>
              <Badge color={c.last_used_at ? 'green' : 'neutral'}>
                {c.last_used_at ? 'Connected' : 'Ready to connect'}
              </Badge>
              <code>{c.token_prefix}••••••</code>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Link2 size={28} />}
          title="Your next conversation starts here"
          description="Add an AI client, choose its permissions, and copy your Mack configuration."
          action={
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={16} />
              Connect your first client
            </Button>
          }
        />
      )}
      <div className="section-heading lower-section">
        <h2>Make yourself at home</h2>
        <span>Works with Streamable HTTP MCP</span>
      </div>
      <div className="quick-client-grid">
        {[
          {
            id: 'claude',
            name: 'Claude Code',
            text: 'Bring your connected world to the terminal.',
          },
          { id: 'cursor', name: 'Cursor', text: 'Keep your tools close to your code.' },
          {
            id: 'custom',
            name: 'Your favorite MCP client',
            text: 'One endpoint, wherever you work.',
          },
        ].map((c) => (
          <button
            key={c.id}
            className="quick-client"
            onClick={() => {
              setType(c.id);
              setAdding(true);
            }}
          >
            <ProviderIcon provider={c.id} size={42} />
            <h3>{c.name}</h3>
            <p>{c.text}</p>
            <span>
              Connect <ArrowRight size={14} />
            </span>
          </button>
        ))}
      </div>
      <p className="privacy-note">
        <ShieldCheck size={16} />
        Bearer-token clients are supported. ChatGPT and other OAuth-only connectors need a future
        OAuth integration.
      </p>
      <CreateClient
        key={`${type}-${adding}-${data.workspace}`}
        open={adding}
        onClose={() => setAdding(false)}
        data={data}
        initialType={type}
        onCreated={setSecret}
      />
      {current && (
        <ClientDetail
          client={current}
          data={data}
          onClose={() => setSelected(null)}
          onSecret={setSecret}
        />
      )}
      <SecretDialog secret={secret} onClose={() => setSecret(null)} notify={data.notify} />
    </>
  );
}
function CreateClient({
  open,
  onClose,
  data,
  initialType,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  data: AppData;
  initialType: string;
  onCreated: (secret: { token: string; endpoint: string }) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState(initialType);
  const [workspace, setWorkspace] = useState(data.workspace);
  const [permissions, setPermissions] = useState<Record<string, Permission>>({});
  const action = useAction(data.refresh, data.notify);
  const connections = data.connections.filter(
    (c) => c.scope === 'personal' || c.workspace_id === workspace,
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bring Mack to your AI"
      description="Start with only the access this client needs. You can change it anytime."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          let secret: { token: string; endpoint: string } | undefined;
          if (
            await action.run(async () => {
              secret = await mutate('/clients', 'POST', {
                name:
                  name ||
                  { claude: 'Claude Code', cursor: 'Cursor', custom: 'MCP client' }[type] ||
                  type,
                type,
                workspace_id: workspace || null,
                permissions: connections.map((c) => ({
                  connection_id: c.id,
                  permission: permissions[c.id] || 'none',
                })),
              });
            })
          ) {
            onClose();
            onCreated(secret!);
            setName('');
            setPermissions({});
          }
        }}
      >
        <div className="form-grid">
          <label className="field">
            Client type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="cursor">Cursor</option>
              <option value="claude">Claude Code</option>
              <option value="windsurf">Windsurf</option>
              <option value="custom">Custom MCP client</option>
            </select>
          </label>
          <label className="field">
            Client name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work laptop"
              maxLength={80}
            />
          </label>
        </div>
        <label className="field">
          Workspace context
          <select
            value={workspace}
            onChange={(e) => {
              setWorkspace(e.target.value);
              setPermissions({});
            }}
          >
            <option value="">Personal only</option>
            {data.session.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} + personal
              </option>
            ))}
          </select>
        </label>
        <div className="permission-heading">
          <h3>Connection access</h3>
          <Badge>Default: no access</Badge>
        </div>
        <div className="permission-list">
          {connections.map((c) => (
            <div className="permission-row" key={c.id}>
              <ProviderIcon provider={c.provider} size={30} />
              <span>
                {c.name}
                <small>{c.scope}</small>
              </span>
              <PermissionSelect
                label={`${c.name} access`}
                value={permissions[c.id] || 'none'}
                onChange={(value) => setPermissions({ ...permissions, [c.id]: value })}
              />
            </div>
          ))}
        </div>
        <ErrorMessage error={action.error} />
        <div className="modal-footer">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Submit busy={action.busy}>Create client key</Submit>
        </div>
      </form>
    </Modal>
  );
}
export function PermissionSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: Permission;
  onChange: (v: Permission) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className="permission-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Permission)}
    >
      <option value="none">No access</option>
      <option value="read">Read only</option>
      <option value="write">Read + write</option>
      <option value="admin">Full access</option>
    </select>
  );
}
function ClientDetail({
  client: c,
  data,
  onClose,
  onSecret,
}: {
  client: Client;
  data: AppData;
  onClose: () => void;
  onSecret: (secret: { token: string; endpoint: string }) => void;
}) {
  const action = useAction(data.refresh, data.notify);
  const [confirm, setConfirm] = useState('');
  const connections = data.connections.filter(
    (conn) => conn.scope === 'personal' || conn.workspace_id === c.workspace_id,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={c.name}
      description="Connection access is always limited by your own permissions and each tool’s enabled state."
    >
      <div className="permission-list">
        {connections.map((conn) => (
          <div className="permission-row" key={conn.id}>
            <ProviderIcon provider={conn.provider} size={34} />
            <span>{conn.name}</span>
            <PermissionSelect
              label={`${conn.name} access`}
              value={
                data.grants.find((g) => g.subject_id === c.id && g.connection_id === conn.id)
                  ?.permission || 'none'
              }
              disabled={action.busy}
              onChange={(permission) =>
                action.run(
                  () =>
                    mutate(`/clients/${c.id}/permissions`, 'PUT', {
                      connection_id: conn.id,
                      permission,
                    }),
                  'Access updated',
                )
              }
            />
          </div>
        ))}
      </div>
      <ErrorMessage error={action.error} />
      <p className="form-hint">
        Rotating a key immediately invalidates the old one. Revoking a client blocks all future
        requests.
      </p>
      <div className="modal-footer">
        <Button
          variant="danger"
          disabled={action.busy}
          onClick={async () => {
            if (confirm !== 'revoke') {
              setConfirm('revoke');
              return;
            }
            if (await action.run(() => mutate(`/clients/${c.id}`, 'DELETE'), 'Client revoked'))
              onClose();
          }}
        >
          {confirm === 'revoke' ? 'Confirm revoke' : 'Revoke client'}
        </Button>
        <Button
          variant="secondary"
          disabled={action.busy}
          onClick={async () => {
            if (confirm !== 'rotate') {
              setConfirm('rotate');
              return;
            }
            await action.run(async () => {
              onSecret(await mutate(`/clients/${c.id}/rotate`, 'POST'));
              onClose();
            });
          }}
        >
          <RefreshCw size={15} />
          {confirm === 'rotate' ? 'Confirm rotation' : 'Rotate key'}
        </Button>
      </div>
    </Modal>
  );
}
function SecretDialog({
  secret,
  onClose,
  notify,
}: {
  secret: { token: string; endpoint: string } | null;
  onClose: () => void;
  notify: (v: string) => void;
}) {
  const config = secret
    ? JSON.stringify(
        {
          mcpServers: {
            mack: { url: secret.endpoint, headers: { Authorization: `Bearer ${secret.token}` } },
          },
        },
        null,
        2,
      )
    : '';
  return (
    <Modal
      open={Boolean(secret)}
      onClose={onClose}
      title="One connection. You’re ready."
      description="Save this key now. For your security, it won’t be shown again."
    >
      <div className="success-callout">
        <Check size={18} />
        Your client key has been created.
      </div>
      <label className="field">
        Mack endpoint
        <div className="copy-field">
          <input value={secret?.endpoint || ''} readOnly />
          <button aria-label="Copy endpoint" onClick={() => copy(secret!.endpoint, notify)}>
            <Copy size={16} />
          </button>
        </div>
      </label>
      <label className="field">
        Client key
        <div className="copy-field">
          <input value={secret?.token || ''} readOnly />
          <button aria-label="Copy client key" onClick={() => copy(secret!.token, notify)}>
            <Copy size={16} />
          </button>
        </div>
      </label>
      <div className="code-heading">
        <span>MCP client configuration</span>
        <button onClick={() => copy(config, notify)}>
          <Copy size={13} />
          Copy JSON
        </button>
      </div>
      <pre className="code-block">{config}</pre>
      <p className="form-hint">
        Use the endpoint and bearer token in your client’s MCP settings. Configuration formats vary
        by client.
      </p>
      <div className="modal-footer">
        <Button onClick={onClose}>
          I’ve saved my key <ArrowRight size={15} />
        </Button>
      </div>
    </Modal>
  );
}
