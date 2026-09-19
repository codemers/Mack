'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import type { Permission, Session } from '@/lib/types';
import { api, mutate } from '@/lib/api';
import { Auth } from './auth';
import { Badge, ErrorMessage, Mark, ProviderIcon, Submit } from './common';
import { PermissionSelect } from './clients';
import { Button } from './ui/button';

interface IncomingConnection {
  id: string;
  name: string;
  provider: string;
  scope: 'personal' | 'workspace';
  workspace_id: string | null;
}

interface IncomingRequest {
  client_name: string;
  client_id: string;
  redirect_uri: string;
  resource: string;
  connections: IncomingConnection[];
}

function clientProvider(name: string) {
  const value = name.toLowerCase();
  if (value.includes('chatgpt') || value.includes('openai')) return 'chatgpt';
  if (value.includes('claude') || value.includes('anthropic')) return 'claude';
  if (value.includes('cursor')) return 'cursor';
  if (value.includes('windsurf')) return 'windsurf';
  return 'custom';
}

export function OAuthAuthorize({ requestId }: { requestId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [auth, setAuth] = useState(false);
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);
  const [workspace, setWorkspace] = useState('');
  const [permissions, setPermissions] = useState<Record<string, Permission>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const s = await api<Session>('/session');
    setSession(s);
    setAuth(false);
    setWorkspace(s.workspaces[0]?.id || '');
    const details = await api<IncomingRequest>(`/oauth/incoming/${encodeURIComponent(requestId)}`);
    setIncoming(details);
  };
  useEffect(() => {
    if (!requestId) {
      setError('This authorization request is missing.');
      return;
    }
    load().catch((e) => {
      if (e instanceof Error && e.message === 'Sign in to continue.') setAuth(true);
      else setError(e instanceof Error ? e.message : 'This authorization request is invalid.');
    });
  }, [requestId]);
  if (auth)
    return (
      <Auth
        description="Sign in to Mack to allow this app to use your connected tools."
        onSuccess={async () => {
          setError('');
          await load();
        }}
      />
    );
  if (!incoming && !error)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <Mark size={32} />
          <Loader2 className="spin" size={22} />
          <p>Checking this connection…</p>
        </div>
      </div>
    );
  if (error && !incoming)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand">
            <Mark size={32} />
            <span>mack.</span>
          </div>
          <h1>This request expired.</h1>
          <p>Start the connection again from your AI client.</p>
          <ErrorMessage error={error} />
        </div>
      </div>
    );
  const connections =
    incoming?.connections.filter((c) => c.scope === 'personal' || c.workspace_id === workspace) ||
    [];
  return (
    <div className="auth-screen">
      <div className="auth-card consent-card">
        <div className="brand">
          <Mark size={32} />
          <span>mack.</span>
        </div>
        <div className="consent-client">
          <ProviderIcon provider={clientProvider(incoming?.client_name || '')} size={42} />
          <div>
            <Badge>OAuth</Badge>
            <h1>{incoming?.client_name} wants access</h1>
            <p>
              Choose the Mack connections this app may use. You can revoke it later from Clients.
            </p>
          </div>
        </div>
        <p className="consent-redirect">
          Redirects to <code>{incoming?.redirect_uri}</code>
        </p>
        {session && session.workspaces.length > 0 && (
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
              {session.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} + personal
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="permission-heading">
          <h3>Connection access</h3>
          <Badge>Default: no access</Badge>
        </div>
        <div className="permission-list">
          {connections.length ? (
            connections.map((c) => (
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
            ))
          ) : (
            <div className="permission-row">
              <span>
                No connections in this context
                <small>Add a connection in Mack first, then try this app again.</small>
              </span>
            </div>
          )}
        </div>
        <p className="privacy-note">
          <ShieldCheck size={16} />
          Access is still limited by your own permissions and each tool’s enabled state.
        </p>
        <ErrorMessage error={error} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const result = await mutate<{ redirect: string }>(
                `/oauth/incoming/${encodeURIComponent(requestId)}/approve`,
                'POST',
                {
                  workspace_id: workspace || null,
                  permissions: connections.map((c) => ({
                    connection_id: c.id,
                    permission: permissions[c.id] || 'none',
                  })),
                },
              );
              window.location.assign(result.redirect);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not approve access.');
              setBusy(false);
            }
          }}
        >
          <div className="modal-footer">
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const result = await mutate<{ redirect: string }>(
                    `/oauth/incoming/${encodeURIComponent(requestId)}/deny`,
                    'POST',
                  );
                  window.location.assign(result.redirect);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not deny access.');
                  setBusy(false);
                }
              }}
            >
              Deny
            </Button>
            <Submit busy={busy}>
              Allow access <ArrowRight size={15} />
            </Submit>
          </div>
        </form>
      </div>
    </div>
  );
}
