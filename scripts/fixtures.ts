import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
export const providers: Record<
  string,
  { name: string; description: string; tools: [string, string][] }
> = {
  github: {
    name: 'GitHub',
    description: 'Repositories, pull requests, and issues.',
    tools: [
      ['search_repositories', 'Find repositories across your organization.'],
      ['search_code', 'Find code and symbols across your repositories.'],
      ['get_pull_request', 'Read a pull request and its review status.'],
      ['list_issues', 'Find open issues and track progress.'],
      ['create_issue', 'Create an issue in a repository.'],
      ['delete_repository', 'Permanently delete a repository.'],
    ],
  },
  slack: {
    name: 'Slack',
    description: 'Keep the conversation connected.',
    tools: [
      ['search_messages', 'Search messages across your channels.'],
      ['list_channels', 'Browse your workspace channels.'],
      ['get_thread', 'Read a conversation thread.'],
      ['send_message', 'Send a message to a channel.'],
    ],
  },
  notion: {
    name: 'Notion',
    description: 'Your team’s knowledge, within reach.',
    tools: [
      ['search_pages', 'Search workspace pages and documents.'],
      ['get_page', 'Read a page and its content.'],
      ['list_databases', 'Browse your shared databases.'],
      ['create_page', 'Create a new page in your workspace.'],
      ['update_page', 'Update the contents of a page.'],
    ],
  },
  linear: {
    name: 'Linear',
    description: 'From a little idea to the next release.',
    tools: [
      ['search_issues', 'Find issues by project, status, or keyword.'],
      ['list_projects', 'Explore projects and milestones.'],
      ['get_issue', 'Get an issue and its details.'],
      ['create_issue', 'Create a new issue for your team.'],
      ['update_issue', 'Update the status of an issue.'],
    ],
  },
  gmail: {
    name: 'Gmail',
    description: 'A little less searching your inbox.',
    tools: [
      ['search_emails', 'Find emails by sender, subject, or keyword.'],
      ['get_email', 'Read an email and its thread.'],
      ['send_email', 'Send an email from your account.'],
    ],
  },
  drive: {
    name: 'Google Drive',
    description: 'All your files, one conversation away.',
    tools: [
      ['search_files', 'Find files and documents in your Drive.'],
      ['get_file', 'Read a document or file.'],
      ['list_folders', 'Browse your folders.'],
      ['create_file', 'Create a file in your Drive.'],
    ],
  },
};
export async function fixtureFetch(request: Request) {
  const provider = new URL(request.url).pathname.split('/')[1];
  const def = providers[provider];
  if (!def) return new Response('Unknown demo provider', { status: 404 });
  const server = new Server(
    { name: `mack-demo-${provider}`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: def.tools.map(([name, description]) => ({
      name,
      description,
      inputSchema: {
        type: 'object' as const,
        properties: { query: { type: 'string', description: 'Search query or item identifier.' } },
        additionalProperties: false,
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!def.tools.some((t) => t[0] === params.name)) throw new Error('Unknown tool');
    const query = String(params.arguments?.query || 'your workspace');
    const items =
      provider === 'github'
        ? [
            {
              title: 'Unify authentication across clients',
              repository: 'apprentx/platform',
              number: 128,
              status: 'Open',
              author: 'Alex Morgan',
            },
            {
              title: 'Add workspace permission checks',
              repository: 'apprentx/platform',
              number: 124,
              status: 'In review',
              author: 'Marie Chen',
            },
          ]
        : provider === 'linear'
          ? [
              {
                title: 'Ship the new onboarding flow',
                identifier: 'ENG-42',
                status: 'In progress',
              },
              { title: 'Review MCP authentication', identifier: 'ENG-38', status: 'Todo' },
            ]
          : provider === 'slack'
            ? [
                {
                  channel: '#engineering',
                  author: 'Marie Chen',
                  text: 'The new auth flow is ready for review. I linked the PR in the project channel.',
                },
                {
                  channel: '#product',
                  author: 'Alex Morgan',
                  text: 'Let’s keep the first-run experience as simple as connect, configure, and go.',
                },
              ]
            : provider === 'notion'
              ? [
                  {
                    title: 'Project Phoenix · Product brief',
                    updated: 'Today',
                    excerpt: 'One place to connect your tools and put your ideas in motion.',
                  },
                  {
                    title: 'Engineering handbook',
                    updated: 'Yesterday',
                    excerpt: 'The decisions, conventions, and context behind our work.',
                  },
                ]
              : provider === 'gmail'
                ? [
                    {
                      subject: 'Your weekly project roundup',
                      from: 'team@example.com',
                      snippet: 'Here’s what moved forward this week.',
                    },
                  ]
                : [
                    { name: 'Q3 product roadmap', type: 'Document', owner: 'You' },
                    { name: 'Brand guidelines', type: 'PDF', owner: 'You' },
                  ];
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              demo: true,
              note: 'Sample data from a local MCP fixture. No external service was called.',
              provider: def.name,
              tool: params.name,
              query,
              items,
            },
            null,
            2,
          ),
        },
      ],
    };
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
