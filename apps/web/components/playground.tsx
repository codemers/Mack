'use client';
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AppData, Connection, Tool } from '@/lib/types';
import { mutate } from '@/lib/api';
import { Badge, ErrorMessage, Mark, ProviderIcon } from './common';
import { Button } from './ui/button';
interface Message {
  id: string;
  kind: 'user' | 'result' | 'error';
  text: string;
  tool?: string;
  demo?: boolean;
}
export function Playground({ data }: { data: AppData }) {
  const tools = useMemo(
    () =>
      data.connections
        .filter((c) => c.status === 'connected')
        .flatMap((c) => c.tools.filter((t) => t.enabled).map((t) => ({ ...t, connection: c }))),
    [data.connections],
  );
  const [selected, setSelected] = useState('');
  const [args, setArgs] = useState('{}');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showTools, setShowTools] = useState(false);
  const current = tools.find((t) => t.public_name === selected);
  const filtered = tools.filter((t) =>
    `${t.remote_name} ${t.description} ${t.connection.name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function choose(t: Tool & { connection: Connection }) {
    setSelected(t.public_name);
    setArgs(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(
            (JSON.parse(t.input_schema).properties || {}) as Record<string, { type?: string }>,
          ).map(([key, schema]) => [
            key,
            schema.type === 'number' || schema.type === 'integer'
              ? 0
              : schema.type === 'boolean'
                ? false
                : schema.type === 'array'
                  ? []
                  : schema.type === 'object'
                    ? {}
                    : '',
          ]),
        ),
        null,
        2,
      ),
    );
    setShowTools(false);
    setError('');
  }
  async function run() {
    if (!current) return;
    setBusy(true);
    setError('');
    let argumentsValue: Record<string, unknown>;
    try {
      argumentsValue = JSON.parse(args);
      if (!argumentsValue || Array.isArray(argumentsValue) || typeof argumentsValue !== 'object')
        throw new Error();
    } catch {
      setError('Arguments must be a valid JSON object.');
      setBusy(false);
      return;
    }
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        kind: 'user',
        text: JSON.stringify(argumentsValue, null, 2),
        tool: current.remote_name,
        demo: Boolean(current.connection.is_demo),
      },
    ]);
    try {
      const result = await mutate<{
        content?: { type: string; text?: string }[];
        isError?: boolean;
      }>('/playground/call', 'POST', { name: current.public_name, arguments: argumentsValue });
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          kind: result.isError ? 'error' : 'result',
          text:
            result.content?.map((c) => c.text || `[${c.type} content]`).join('\n') ||
            JSON.stringify(result, null, 2),
          tool: current.connection.name,
          demo: Boolean(current.connection.is_demo),
        },
      ]);
      await data.refresh();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          kind: 'error',
          text: e instanceof Error ? e.message : 'Tool call failed',
        },
      ]);
      await data.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`playground ${messages.length ? 'has-messages' : ''}`}>
      <div className="playground-top">
        <Badge>
          <Terminal size={12} />
          Connection playground
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setMessages([]);
            setSelected('');
            setArgs('{}');
            setQuery('');
          }}
        >
          <Plus size={15} />
          New session
        </Button>
      </div>
      {!messages.length ? (
        <div className="playground-welcome">
          <span className="welcome-mark">
            <Mark size={39} />
          </span>
          <div className="eyebrow">YOUR WORLD IS WITHIN REACH</div>
          <h1>
            A little context.
            <br />A lot of possibilities.
          </h1>
          <p>
            Try your connected tools, right here.
            <br />
            Choose a tool and see exactly what comes back.
          </p>
          <div className="prompt-grid">
            {[
              {
                provider: 'github',
                title: 'Explore your code',
                text: 'Find issues and pull requests',
                tool: 'list_issues',
              },
              {
                provider: 'slack',
                title: 'Catch up on the conversation',
                text: 'Search your team’s messages',
                tool: 'search_messages',
              },
              {
                provider: 'linear',
                title: 'See what’s moving',
                text: 'Find your next priority',
                tool: 'search_issues',
              },
            ].map((p) => (
              <button
                key={p.provider}
                disabled={
                  !tools.some(
                    (t) => t.connection.provider === p.provider && t.remote_name === p.tool,
                  )
                }
                onClick={() => {
                  const t = tools.find(
                    (t) => t.connection.provider === p.provider && t.remote_name === p.tool,
                  );
                  if (t) choose(t);
                }}
              >
                <ProviderIcon provider={p.provider} size={31} />
                <strong>{p.title}</strong>
                <span>{p.text}</span>
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="messages">
          {messages.map((m) => (
            <div className={`message message-${m.kind}`} key={m.id}>
              <div className="message-label">
                {m.kind === 'user' ? (
                  <span className="avatar tiny">{data.session.user.name[0]}</span>
                ) : (
                  <Mark size={20} />
                )}
                <strong>
                  {m.kind === 'user' ? 'You' : m.kind === 'error' ? 'Request failed' : 'Mack'}
                </strong>
                <span>{m.tool}</span>
                {m.demo && <Badge>Demo result</Badge>}
              </div>
              <pre>{m.text}</pre>
            </div>
          ))}
          {busy && (
            <div className="working">
              <Loader2 className="spin" size={17} />
              Calling your MCP server…
            </div>
          )}
        </div>
      )}
      <div className="composer-area">
        <div className="composer">
          <div className="composer-toolbar">
            <button className="tool-selector" onClick={() => setShowTools(!showTools)}>
              {current ? (
                <>
                  <ProviderIcon provider={current.connection.provider} size={23} />
                  {current.remote_name}
                </>
              ) : (
                <>
                  <Code2 size={17} />
                  Choose a tool
                </>
              )}
              <ChevronDown size={14} />
            </button>
            {current && (
              <Badge color={current.risk_level === 'read' ? 'blue' : 'amber'}>
                {current.risk_level}
              </Badge>
            )}
            <span>{tools.length} tools available</span>
          </div>
          {showTools && (
            <div className="tool-picker">
              <div className="tool-picker-search">
                <Search size={15} />
                <input
                  autoFocus
                  placeholder="Search your connected tools…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div>
                {filtered.map((t) => (
                  <button key={t.id} onClick={() => choose(t)}>
                    <ProviderIcon provider={t.connection.provider} size={27} />
                    <span>
                      <strong>{t.remote_name}</strong>
                      <small>{t.connection.name}</small>
                    </span>
                    <Badge>{t.risk_level}</Badge>
                  </button>
                ))}
                {!filtered.length && <p>No matching tools. Enable a tool in Connections first.</p>}
              </div>
            </div>
          )}
          {current ? (
            <>
              <label className="composer-label" htmlFor="tool-arguments">
                Tool arguments · JSON
              </label>
              <textarea
                id="tool-arguments"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                spellCheck={false}
                rows={4}
              />
              <div className="composer-bottom">
                <span>
                  {current.connection.is_demo
                    ? 'Local demo · sample data'
                    : current.risk_level !== 'read'
                      ? 'This tool may change data in your connected service.'
                      : 'Runs directly against your connected server.'}
                </span>
                <Button disabled={busy} onClick={run}>
                  {busy ? <Loader2 size={16} className="spin" /> : <ArrowUp size={16} />}Run tool
                </Button>
              </div>
            </>
          ) : (
            <div className="composer-placeholder">
              What would you like to explore?<span>Select a tool above to get started.</span>
              <span className="send-placeholder">
                <ArrowUp size={17} />
              </span>
            </div>
          )}
        </div>
        <ErrorMessage error={error} />
        <p className="composer-note">
          <ShieldCheck size={13} />A direct tool playground. Your AI clients handle the
          conversation.
        </p>
      </div>
    </div>
  );
}
