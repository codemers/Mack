import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Mack — Connect once. Ask anywhere.',
  description: 'One place to connect your tools and control how AI accesses your world.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
