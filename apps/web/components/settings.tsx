'use client';
import { Copy, KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { AppData } from '@/lib/types';
import { copy, mutate } from '@/lib/api';
import { Badge, ErrorMessage, PageHeading, Submit, useAction } from './common';
import { Button } from './ui/button';
export function Settings({ data }: { data: AppData }) {
  const [name, setName] = useState(data.session.user.name);
  const [workspaceName, setWorkspaceName] = useState('');
  const action = useAction(data.refresh, data.notify);
  return (
    <>
      <PageHeading
        eyebrow="MAKE YOURSELF AT HOME"
        title="The details that make it yours."
        description="Your profile, your spaces, and your connection to Mack."
      />
      <div className="settings-panel">
        <div className="settings-heading">
          <h3>Your profile</h3>
          <p>A familiar face in your workspace.</p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await action.run(() => mutate('/profile', 'PATCH', { name }), 'Profile saved');
          }}
        >
          <label className="field">
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </label>
          <label className="field">
            Email address
            <input value={data.session.user.email} readOnly />
          </label>
          <Submit busy={action.busy}>Save changes</Submit>
        </form>
      </div>
      <div className="settings-panel">
        <div className="settings-heading">
          <h3>Your workspaces</h3>
          <p>A shared home for your team’s connections.</p>
        </div>
        <div>
          {data.session.workspaces.map((w) => (
            <div className="workspace-setting" key={w.id}>
              <span className="workspace-avatar">{w.name[0]}</span>
              <strong>{w.name}</strong>
              <Badge>{w.role}</Badge>
            </div>
          ))}
          <form
            className="workspace-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action.run(
                  () => mutate('/workspaces', 'POST', { name: workspaceName }),
                  'Workspace created',
                )
              )
                setWorkspaceName('');
            }}
          >
            <label className="field">
              New workspace
              <input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Your team or company"
                required
                maxLength={80}
              />
            </label>
            <Button variant="secondary" disabled={action.busy}>
              <Plus size={15} />
              Create workspace
            </Button>
          </form>
        </div>
      </div>
      <div className="settings-panel">
        <div className="settings-heading">
          <h3>Mack endpoint</h3>
          <p>One URL for your connected world.</p>
        </div>
        <div>
          <div className="copy-field">
            <input readOnly value={data.session.gatewayUrl} />
            <button
              aria-label="Copy endpoint"
              onClick={() => copy(data.session.gatewayUrl, data.notify)}
            >
              <Copy size={16} />
            </button>
          </div>
          <p className="form-hint">
            Create a client key in Clients to authenticate. Your account session cannot be used as
            an MCP token.
          </p>
        </div>
      </div>
      <div className="settings-panel">
        <div className="settings-heading">
          <h3>Security by default</h3>
          <p>Access you can understand and control.</p>
        </div>
        <div className="security-facts">
          <p>
            <ShieldCheck size={17} />
            External credentials encrypted with AES-256-GCM
          </p>
          <p>
            <KeyRound size={17} />
            Client keys stored as hashes, never as plain text
          </p>
          <p>
            <ShieldCheck size={17} />
            Permissions checked on every tool call
          </p>
          {data.session.demo && (
            <p className="demo-fact">
              You’re in a local demo. Sample services run on your computer.
            </p>
          )}
        </div>
      </div>
      <ErrorMessage error={action.error} />
    </>
  );
}
