'use client';
import { Copy, Plus, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppData, Grant, Permission, User } from '@/lib/types';
import { api, copy, mutate } from '@/lib/api';
import { Badge, Empty, ErrorMessage, PageHeading, ProviderIcon, Submit, useAction } from './common';
import { PermissionSelect } from './clients';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
interface TeamData {
  members: (User & { role: string })[];
  teams: { id: string; name: string }[];
  teamMembers: { team_id: string; user_id: string }[];
  invitations: { id: string; email: string; role: string; expires_at: number }[];
  permissions: Grant[];
}
export function TeamPage({ data }: { data: AppData }) {
  const [team, setTeam] = useState<TeamData | null>(null);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [inviteUrl, setInviteUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [subject, setSubject] = useState<{
    id: string;
    name: string;
    type: 'user' | 'team';
  } | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);
  const workspace = data.session.workspaces.find((w) => w.id === data.workspace);
  const manager = workspace?.role === 'admin' || workspace?.role === 'owner';
  const reload = async () => {
    if (!data.workspace) return;
    setTeam(await api<TeamData>(`/workspaces/${data.workspace}/members`));
  };
  const action = useAction(reload, data.notify);
  useEffect(() => {
    setTeam(null);
    setError('');
    if (data.workspace)
      api<TeamData>(`/workspaces/${data.workspace}/members`)
        .then(setTeam)
        .catch((e) => setError(e.message));
  }, [data.workspace]);
  if (!workspace)
    return (
      <>
        <PageHeading
          title="Better, together."
          description="Create a workspace in Settings to share connections with your team."
        />
        <Empty
          icon={<Users size={28} />}
          title="A space for your people"
          description="Personal connections always stay private. Workspaces let you choose what to share."
        />
      </>
    );
  return (
    <>
      <PageHeading
        eyebrow="SHARED STAYS CONTROLLED"
        title="Good company. Great work."
        description={`The people and permissions behind ${workspace.name}.`}
        action={
          manager && (
            <Button
              onClick={() => {
                setInviteUrl('');
                setInvite(true);
              }}
            >
              <UserPlus size={16} />
              Invite member
            </Button>
          )
        }
      />
      <ErrorMessage error={error} />
      <div className="section-heading">
        <h2>
          Workspace members <span>{team?.members.length || 0}</span>
        </h2>
        <Badge>
          <Users size={12} />
          {workspace.name}
        </Badge>
      </div>
      <div className="member-list">
        {team?.members.map((m, i) => (
          <div className="member-row" key={m.id}>
            <span className={`avatar avatar-${i % 3}`}>
              {m.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <h3>
                {m.name}
                {m.id === data.session.user.id && <span className="you-label">You</span>}
              </h3>
              <p>{m.email}</p>
            </div>
            <Badge color={m.role === 'owner' ? 'amber' : 'neutral'}>{m.role}</Badge>
            {manager && m.role === 'member' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSubject({ id: m.id, name: m.name, type: 'user' })}
              >
                Manage access
              </Button>
            )}
            {manager &&
              m.role !== 'owner' &&
              (workspace.role === 'owner' || m.role === 'member') && (
                <button
                  className="icon-button"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => setRemoving(m)}
                >
                  <Trash2 size={15} />
                </button>
              )}
          </div>
        ))}
      </div>
      {Boolean(team?.invitations.length) && (
        <div className="pending-invites">
          <h3>Pending invitations</h3>
          {team?.invitations.map((i) => (
            <div key={i.id}>
              <span>{i.email}</span>
              <Badge>{i.role}</Badge>
              <small>Expires {new Date(i.expires_at).toLocaleDateString()}</small>
            </div>
          ))}
        </div>
      )}
      <div className="section-heading lower-section">
        <h2>
          Teams <span>{team?.teams.length || 0}</span>
        </h2>
        {manager && (
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            Create team
          </Button>
        )}
      </div>
      <div className="team-grid">
        {team?.teams.map((t) => (
          <button
            className="team-card"
            key={t.id}
            disabled={!manager}
            onClick={() => setSubject({ id: t.id, name: t.name, type: 'team' })}
          >
            <span className="soft-icon">
              <Users size={22} />
            </span>
            <h3>{t.name}</h3>
            <p>{team.teamMembers.filter((m) => m.team_id === t.id).length} members</p>
            <div className="team-card-footer">
              <span className="avatar-stack">
                {team.teamMembers
                  .filter((m) => m.team_id === t.id)
                  .slice(0, 4)
                  .map((m) => (
                    <span key={m.user_id} className="avatar tiny">
                      {team.members.find((u) => u.id === m.user_id)?.name[0]}
                    </span>
                  ))}
              </span>
              <span>Manage access →</span>
            </div>
          </button>
        ))}
      </div>
      <p className="privacy-note">
        <ShieldCheck size={16} />
        Members start with no shared access. Grant permissions to a person or a team.
      </p>
      <Modal
        open={invite}
        onClose={() => setInvite(false)}
        title={inviteUrl ? 'An invitation, ready to share' : 'There’s room for one more'}
        description={
          inviteUrl
            ? 'Send this link to your teammate. They must sign up with the invited email.'
            : 'Invite someone to your workspace. The link is valid for seven days.'
        }
      >
        {inviteUrl ? (
          <>
            <div className="copy-field">
              <input readOnly value={inviteUrl} />
              <button aria-label="Copy invite link" onClick={() => copy(inviteUrl, data.notify)}>
                <Copy size={16} />
              </button>
            </div>
            <p className="form-hint">No email was sent automatically.</p>
            <div className="modal-footer">
              <Button onClick={() => setInvite(false)}>Done</Button>
            </div>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await action.run(async () => {
                const result = await mutate<{ url: string }>(
                  `/workspaces/${data.workspace}/invitations`,
                  'POST',
                  { email, role },
                );
                setInviteUrl(result.url);
                setEmail('');
              });
            }}
          >
            <label className="field">
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </label>
            <label className="field">
              Workspace role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">Member — use permitted connections</option>
                {workspace.role === 'owner' && (
                  <option value="admin">Admin — manage connections and members</option>
                )}
              </select>
            </label>
            <ErrorMessage error={action.error} />
            <div className="modal-footer">
              <Submit busy={action.busy}>Create invitation link</Submit>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="A team with a shared purpose"
        description="Group people together to manage their connection access."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(
                () =>
                  mutate(`/workspaces/${data.workspace}/teams`, 'POST', {
                    name: teamName,
                    member_ids: memberIds,
                  }),
                'Team created',
              )
            ) {
              setCreating(false);
              setTeamName('');
              setMemberIds([]);
            }
          }}
        >
          <label className="field">
            Team name
            <input
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Engineering"
              maxLength={80}
            />
          </label>
          <h3 className="small-heading">Members</h3>
          <div className="checkbox-list">
            {team?.members.map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  checked={memberIds.includes(m.id)}
                  onChange={(e) =>
                    setMemberIds(
                      e.target.checked
                        ? [...memberIds, m.id]
                        : memberIds.filter((id) => id !== m.id),
                    )
                  }
                />
                {m.name}
                <span>{m.email}</span>
              </label>
            ))}
          </div>
          <ErrorMessage error={action.error} />
          <div className="modal-footer">
            <Submit busy={action.busy}>Create team</Submit>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(subject)}
        onClose={() => setSubject(null)}
        title={`${subject?.name || ''} · access`}
        description="Shared connections only. A ‘No access’ grant explicitly denies access even if another team grants it."
      >
        <div className="permission-list">
          {data.connections
            .filter((c) => c.workspace_id === data.workspace)
            .map((c) => (
              <div className="permission-row" key={c.id}>
                <ProviderIcon provider={c.provider} size={32} />
                <span>{c.name}</span>
                <PermissionSelect
                  label={`${c.name} access`}
                  value={
                    team?.permissions.find(
                      (g) => g.subject_id === subject?.id && g.connection_id === c.id && !g.tool_id,
                    )?.permission || 'none'
                  }
                  disabled={action.busy}
                  onChange={(permission) =>
                    action.run(
                      () =>
                        mutate(`/workspaces/${data.workspace}/permissions`, 'PUT', {
                          connection_id: c.id,
                          subject_id: subject!.id,
                          subject_type: subject!.type,
                          permission,
                        }),
                      'Permissions saved',
                    )
                  }
                />
              </div>
            ))}
        </div>
        <ErrorMessage error={action.error} />
      </Modal>
      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description="They will immediately lose access to this workspace and its shared connections."
      >
        <ErrorMessage error={action.error} />
        <div className="modal-footer">
          <Button variant="secondary" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={action.busy}
            onClick={async () => {
              if (
                await action.run(
                  () => mutate(`/workspaces/${data.workspace}/members/${removing!.id}`, 'DELETE'),
                  'Member removed',
                )
              )
                setRemoving(null);
            }}
          >
            Remove member
          </Button>
        </div>
      </Modal>
    </>
  );
}
