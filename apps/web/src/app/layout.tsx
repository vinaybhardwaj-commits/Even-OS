import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { CockpitFab } from './(admin)/admin/test-cockpit/cockpit-fab';
import { ChatProvider } from '@/providers/ChatProvider';

export const metadata: Metadata = {
  title: 'Even OS',
  description: 'Hospital Operating System by Even Healthcare',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-gray-50 text-gray-900">
        <ChatProvider>
          {children}
        </ChatProvider>
        <Suspense fallback={null}>
          <CockpitFab />
        </Suspense>
      </body>
    </html>
  );
}
