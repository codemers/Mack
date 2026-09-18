'use client';
import { ArrowUpRight, Boxes, Check, Github, Loader2, Mail, Plug, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from './ui/button';
export function Mark({ size = 29 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M5 25V10.5C5 8 8.1 6.7 9.8 8.6L16 16l6.2-7.4C23.9 6.7 27 8 27 10.5V25"
        stroke="currentColor"
        strokeWidth="4.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16 17v8" stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" />
    </svg>
  );
}
export function ProviderIcon({ provider, size = 44 }: { provider: string; size?: number }) {
  return (
    <span
      className={`provider-icon provider-${provider}`}
      style={{ width: size, height: size, fontSize: size * 0.53 }}
    >
      {provider === 'github' ? (
        <Github size={size * 0.56} fill="currentColor" strokeWidth={1.5} />
      ) : provider === 'slack' ? (
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24">
          <path d="M9 2v9H2" stroke="#36c5f0" strokeWidth="4" strokeLinecap="round" />
          <path d="M22 9h-9V2" stroke="#2eb67d" strokeWidth="4" strokeLinecap="round" />
          <path d="M15 22v-9h7" stroke="#ecb22e" strokeWidth="4" strokeLinecap="round" />
          <path d="M2 15h9v7" stroke="#e01e5a" strokeWidth="4" strokeLinecap="round" />
        </svg>
      ) : provider === 'notion' ? (
        <b className="notion-letter">N</b>
      ) : provider === 'linear' ? (
        <svg width={size * 0.57} height={size * 0.57} viewBox="0 0 24 24">
          <defs>
            <clipPath id={`linear-${size}`}>
              <circle cx="12" cy="12" r="11" />
            </clipPath>
          </defs>
          <circle cx="12" cy="12" r="11" fill="#6866dd" />
          <g clipPath={`url(#linear-${size})`} stroke="white" strokeWidth="1.7">
            <path d="M-2 8l18 18M-2 13l13 13M-2 18l8 8M1 3l23 23" />
          </g>
        </svg>
      ) : provider === 'gmail' ? (
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" strokeWidth="4">
          <path d="M3 19V6l9 7 9-7v13" stroke="#4285f4" />
          <path d="M3 6l9 7 9-7" stroke="#ea4335" />
          <path d="M3 6v13" stroke="#34a853" />
          <path d="M21 6v13" stroke="#fbbc04" />
        </svg>
      ) : provider === 'drive' ? (
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
          <path d="M9 2h7l8 14h-7z" fill="#fbbc04" />
          <path d="M9 2L1 16l4 6 8-14z" fill="#34a853" />
          <path d="M5 22h15l4-6H9z" fill="#4285f4" />
        </svg>
      ) : provider === 'claude' ? (
        <span className="claude-symbol">✳</span>
      ) : provider === 'cursor' ? (
        <span className="cursor-symbol">◈</span>
      ) : provider === 'chatgpt' ? (
        <Boxes size={size * 0.58} />
      ) : (
        <Plug size={size * 0.5} />
      )}
    </span>
  );
}
export function Badge({ children, color = 'neutral' }: { children: ReactNode; color?: string }) {
  return <span className={`badge badge-${color}`}>{children}</span>;
}
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={16} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  icon = <Plug size={27} />,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <div role="alert" className="error-message">
      {error}
    </div>
  ) : null;
}
export function Submit({
  busy,
  children,
  disabled,
}: {
  busy: boolean;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button type="submit" disabled={busy || disabled}>
      {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {children}
    </Button>
  );
}
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'checked' : ''}`}
      onClick={onChange}
      disabled={disabled}
    >
      <span />
    </button>
  );
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-link">
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
export function useAction(refresh: () => Promise<void>, notify: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return {
    busy,
    error,
    setError,
    run: async (action: () => Promise<unknown>, message?: string) => {
      setBusy(true);
      setError('');
      try {
        await action();
        await refresh();
        if (message) notify(message);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
