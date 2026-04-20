import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'ReconAI — AI-native trade reconciliation',
  description:
    'Bounded AI · deterministic matching · audit-first. A portfolio MVP for enterprise securities reconciliation.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning on <body> too — Grammarly / LanguageTool /
          1Password browser extensions inject attributes like
          `data-new-gr-c-s-check-loaded` into the body before React hydrates.
          Without this, dev mode shows a "Hydration failed" error for every
          visitor who has those extensions on. */}
      <body
        className={`${inter.variable} ${mono.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
