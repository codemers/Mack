'use client';
import { useState } from 'react';
import { mutate } from '@/lib/api';
import { ErrorMessage, Mark, Submit } from './common';

export function Auth({
  onSuccess,
  description = 'Connect once. Ask anywhere.',
}: {
  onSuccess: () => Promise<void>;
  description?: string;
}) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <Mark size={32} />
          <span>mack.</span>
        </div>
        <h1>{mode === 'login' ? 'Welcome back.' : 'Your world, connected.'}</h1>
        <p>{description}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await mutate(`/auth/${mode}`, 'POST', {
                email,
                password,
                ...(mode === 'register' ? { name } : {}),
              });
              await onSuccess();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Unable to sign in');
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === 'register' && (
            <label className="field">
              Full name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          <label className="field">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            <small>At least 12 characters.</small>
          </label>
          <ErrorMessage error={error} />
          <Submit busy={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</Submit>
        </form>
        <button
          className="auth-toggle"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? 'New to Mack? Create an account' : 'Already connected? Sign in'}
        </button>
      </div>
    </div>
  );
}
