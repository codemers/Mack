'use client';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Layers3,
  Link2,
  Loader2,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  Activity as ActivityType,
  AppData,
  Client,
  Connection,
  Grant,
  Page,
  Session,
} from '@/lib/types';
import { api, mutate } from '@/lib/api';
import { Connections } from '@/components/connections';
import { Clients } from '@/components/clients';
import { ActivityPage } from '@/components/activity';
import { Playground } from '@/components/playground';
import { TeamPage } from '@/components/team';
import { Settings } from '@/components/settings';
import { Badge, ErrorMessage, Mark } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Auth } from '@/components/auth';
const navigation = [
  { id: 'chat', label: 'Playground', icon: MessageCircle },
  { id: 'connections', label: 'Connections', icon: Link2 },
  { id: 'clients', label: 'Clients', icon: Layers3 },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'team', label: 'Team', icon: Users },
] as const;
export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [activity, setActivity] = useState<ActivityType[]>([]);
  const [workspace, setWorkspace] = useState('__initial');
  const [page, setPage] = useState<Page>('connections');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [auth, setAuth] = useState(false);
  const [invite, setInvite] = useState('');
  const [accepting, setAccepting] = useState(false);
  const refresh = useCallback(async () => {
    const s = await api<Session>('/session');
    const [c, cl, a] = await Promise.all([
      api<{ connections: Connection[] }>('/connections'),
      api<{ clients: Client[]; permissions: Grant[] }>('/clients'),
      api<{ activity: ActivityType[] }>('/activity'),
    ]);
    setSession(s);
    setConnections(c.connections);
    setClients(cl.clients);
    setGrants(cl.permissions);
    setActivity(a.activity);
    setWorkspace((w) => (w === '__initial' ? s.workspaces[0]?.id || '' : w));
    setAuth(false);
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => {
        if (e.message === 'Sign in to continue.') setAuth(true);
        else setError(e.message);
      })
      .finally(() => setLoading(false));
    const valid: Page[] = ['connections', 'chat', 'clients', 'activity', 'team', 'settings'];
    const onHash = () => {
      const value = location.hash.slice(1) as Page;
      if (valid.includes(value)) setPage(value);
    };
    onHash();
    const oauthResult = new URLSearchParams(location.search).get('oauth');
    if (oauthResult) {
      const messages: Record<string, string> = {
        connected: 'OAuth connected. Review tools before enabling them.',
        cancelled: 'OAuth authorization was cancelled.',
        failed: 'OAuth authorization failed. Please try connecting again.',
        discovery_failed:
          'OAuth connected, but discovery failed. Open the connection and refresh tools.',
      };
      setToast(messages[oauthResult] || 'OAuth flow finished.');
      const clean = new URL(location.href);
      clean.searchParams.delete('oauth');
      history.replaceState(null, '', clean);
    }
    setInvite(new URLSearchParams(location.search).get('invite') || '');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = (p: Page) => {
    setPage(p);
    location.hash = p;
    setMenu(false);
  };
  if (loading)
    return (
      <div className="loading-screen">
        <Mark size={48} />
        <Loader2 className="spin" size={22} />
        <p>Getting your world together…</p>
      </div>
    );
  if (auth) return <Auth onSuccess={refresh} />;
  if (!session)
    return (
      <div className="loading-screen">
        <Mark size={48} />
        <h2>Let’s reconnect.</h2>
        <ErrorMessage error={error || 'Mack could not reach the API.'} />
        <Button
          onClick={() => {
            setLoading(true);
            refresh()
              .catch((e) => setError(e.message))
              .finally(() => setLoading(false));
          }}
        >
          Try again
        </Button>
      </div>
    );
  const data: AppData = {
    session,
    connections,
    clients,
    grants,
    activity,
    workspace,
    refresh,
    notify: setToast,
  };
  const selectedWorkspace = session.workspaces.find((w) => w.id === workspace);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
        <button className="brand" onClick={() => navigate('connections')}>
          <Mark size={29} />
          <span>
            mack<span className="brand-period">.</span>
          </span>
          <Badge>beta</Badge>
        </button>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            {selectedWorkspace?.name[0] || session.user.name[0]}
          </span>
          <div>
            <strong>{selectedWorkspace?.name || 'Personal'}</strong>
            <span>{selectedWorkspace ? 'Workspace' : 'Just for you'}</span>
          </div>
          <ChevronDown size={14} />
          <select
            aria-label="Select workspace"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          >
            <option value="">Personal</option>
            {session.workspaces.map((w) => (
              <option value={w.id} key={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <Button className="new-chat" variant="secondary" onClick={() => navigate('chat')}>
          <Plus size={16} />
          New session
        </Button>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
            >
              <item.icon size={18} strokeWidth={1.65} />
              <span>{item.label}</span>
              {item.id === 'connections' && (
                <em>
                  {
                    connections.filter(
                      (c) => c.scope === 'personal' || c.workspace_id === workspace,
                    ).length
                  }
                </em>
              )}
              {page === item.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-star">✳</span>
            <strong>
              Less setup.
              <br />
              More possibility.
            </strong>
            <p>Your tools, ready for whatever comes next.</p>
            <button onClick={() => setHelp(true)}>
              A quick introduction <ArrowRight size={13} />
            </button>
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <SettingsIcon size={18} strokeWidth={1.65} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={18} strokeWidth={1.65} />
            <span>Help & getting started</span>
            <ExternalLink size={12} />
          </button>
          <div className="profile">
            <span className="avatar">
              {session.user.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
            <button onClick={() => navigate('settings')}>
              <strong>{session.user.name}</strong>
              <span>{session.demo ? 'Demo account' : session.user.email}</span>
            </button>
            {!session.demo && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  await mutate('/auth/logout', 'POST');
                  setAuth(true);
                  setSession(null);
                }}
              >
                <LogOut size={15} />
              </button>
            )}
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              onClick={() => setMenu(true)}
              aria-label="Open navigation"
            >
              <Menu size={19} />
            </button>
            <span className="breadcrumb-icon">
              <Layers3 size={15} />
            </span>
            <span>{selectedWorkspace?.name || 'Personal'}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {page === 'settings' ? 'Settings' : navigation.find((n) => n.id === page)?.label}
            </strong>
          </div>
          <div>
            {session.demo && (
              <Badge color="amber">
                <span className="badge-dot" />
                Local demo
              </Badge>
            )}
            <span className="topbar-divider" />
            <button className="topbar-help" aria-label="Quick guide" onClick={() => setHelp(true)}>
              <BookOpen size={15} />
              <span>Quick guide</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </header>
        <main className={`main-content ${page === 'chat' ? 'chat-main' : ''}`}>
          {invite && (
            <div className="invite-banner">
              <Users size={18} />
              <span>You have a workspace invitation.</span>
              <Button
                size="sm"
                disabled={accepting}
                onClick={async () => {
                  setAccepting(true);
                  try {
                    await mutate('/invitations/accept', 'POST', { token: invite });
                    await refresh();
                    setInvite('');
                    history.replaceState(null, '', location.pathname + location.hash);
                    setToast('Welcome to your workspace');
                  } catch (e) {
                    setToast(e instanceof Error ? e.message : 'Could not accept invitation');
                  } finally {
                    setAccepting(false);
                  }
                }}
              >
                Accept invitation
              </Button>
            </div>
          )}
          {page === 'connections' ? (
            <Connections data={data} onClients={() => navigate('clients')} />
          ) : page === 'clients' ? (
            <Clients data={data} />
          ) : page === 'activity' ? (
            <ActivityPage data={data} onPlayground={() => navigate('chat')} />
          ) : page === 'chat' ? (
            <Playground data={data} />
          ) : page === 'team' ? (
            <TeamPage data={data} />
          ) : (
            <Settings data={data} />
          )}
        </main>
        <footer className="app-footer">
          <span>
            <Mark size={13} />
            Connect once. Ask anywhere.
          </span>
          <span>
            <span className="live-dot" />
            Your access, under your control.
          </span>
        </footer>
      </div>
      {toast && (
        <div role="status" className="toast">
          <Check size={16} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      <Modal
        open={help}
        onClose={() => setHelp(false)}
        title="Your world, a little more connected."
        description="Mack is the access layer between your AI and your tools."
      >
        <div className="guide-steps">
          {[
            [
              '01',
              'Connect your tools',
              'Add a remote MCP server in Connections. Choose personal or workspace ownership, then review its tools.',
            ],
            [
              '02',
              'Choose what’s possible',
              'Enable the tools you need. Read tools start enabled; write and admin tools require your choice.',
            ],
            [
              '03',
              'Bring your AI',
              'Connect ChatGPT and other OAuth clients with the Mack endpoint, or create a bearer key for Cursor, Claude Code, and custom clients.',
            ],
            [
              '04',
              'See the whole picture',
              'Try a tool in the playground, then check Activity for its result, timing, and redacted arguments.',
            ],
          ].map(([n, title, text]) => (
            <div key={n}>
              <span>{n}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </div>
        {session.demo && (
          <div className="demo-explanation">
            <ShieldCheck size={18} />
            <p>
              This local demo includes six sample MCP servers. They return fixture data and never
              call your actual accounts. Add your own server to use real data.
            </p>
          </div>
        )}
        <div className="modal-footer">
          <Button onClick={() => setHelp(false)}>
            Let’s get connected <ArrowRight size={15} />
          </Button>
        </div>
      </Modal>
    </div>
  );
}
