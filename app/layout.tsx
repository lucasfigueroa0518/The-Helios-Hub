import { Roboto } from 'next/font/google';
import localFont from 'next/font/local';

import { HubChrome } from '@/components/hub-shell/HubChrome';
import { getSession } from '@/lib/session';

import './globals.css';
import './components.css';
import './hub-shell.css';

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-roboto',
  display: 'swap',
});

const pragmatica = localFont({
  src: './fonts/PragmaticaExtended-Bold.otf',
  weight: '700',
  style: 'normal',
  variable: '--font-pragmatica',
  display: 'swap',
});

export const metadata = {
  title: 'The Helios Hub',
  description: 'The Helios Hub — Outreach, Dashboards, and Trello',
  icons: {
    icon: '/icon.png',
    shortcut: '/favicon.ico',
    apple: '/icon.png',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <html lang="en" className={`${roboto.variable} ${pragmatica.variable}`}>
      {/* Tailwind is scoped to `.helios-ui` (tailwind.config.ts `important`), which
          emits every utility as a descendant selector. Radix portals mount on
          document.body, so the scope root has to be the body itself — otherwise
          dialogs and popovers render with no positioning or background while still
          holding the page's pointer-events lock. */}
      <body className="helios-ui">
        {session ? <HubChrome email={session.email}>{children}</HubChrome> : children}
      </body>
    </html>
  );
}
