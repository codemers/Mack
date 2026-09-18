type Description = { label: string; description: string; access: string };

// Descriptions are provider-specific; unfamiliar scopes are never inferred to be read-only.
// Sources: https://linear.app/developers/oauth-2-0-authentication
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
const descriptions: Record<string, Record<string, Description>> = {
  // https://docs.slack.dev/ai/slack-mcp-server/
  'mcp.slack.com': {
    'search:read.public': {
      label: 'Search public channels',
      description: 'Search public-channel messages and files.',
      access: 'Read',
    },
    'channels:history': {
      label: 'Read public-channel history',
      description: 'Retrieve messages in public channels.',
      access: 'Read',
    },
    'channels:read': {
      label: 'Read public-channel information',
      description: 'View public-channel details and members.',
      access: 'Read',
    },
    'users:read': {
      label: 'Read user information',
      description: 'View people in your workspace.',
      access: 'Read',
    },
    'chat:write': {
      label: 'Send messages',
      description: 'Post messages on your behalf.',
      access: 'Write',
    },
  },
  'mcp.linear.app': {
    read: {
      label: 'Read Linear data',
      description: 'Read information available to your Linear account.',
      access: 'Read',
    },
    write: {
      label: 'Create and update Linear data',
      description:
        'Make changes with your Linear account. Enable only if your tools need to write data.',
      access: 'Write',
    },
    openid: {
      label: 'Sign-in identity',
      description: 'Include your account identity in the authorization.',
      access: 'Identity',
    },
    email: {
      label: 'Email address',
      description: 'Include your account email address.',
      access: 'Identity',
    },
  },
  'api.githubcopilot.com': {
    repo: {
      label: 'Repository access',
      description:
        'Broad access to public and private repositories, including changes and administration.',
      access: 'Read & write',
    },
    'read:org': {
      label: 'Read organization information',
      description: 'Read organization membership, teams, and projects.',
      access: 'Read',
    },
  },
};

export function describeScope(host: string, value: string): Description {
  return (
    descriptions[host]?.[value] ?? {
      label: value,
      description:
        'Provider-defined permission. Review its access on the provider’s consent screen.',
      access: 'Provider-defined',
    }
  );
}
