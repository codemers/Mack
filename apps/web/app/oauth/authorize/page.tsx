import { OAuthAuthorize } from '@/components/oauth-authorize';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request } = await searchParams;
  return <OAuthAuthorize requestId={request || ''} />;
}
