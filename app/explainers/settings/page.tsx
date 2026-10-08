import { redirect } from 'next/navigation';

import { SettingsForm } from '@/app/explainers/settings/settings-form';
import { Section } from '@/app/reels/ui';
import { explainersDb } from '@/lib/explainers/connection';
import { loadSettingsView } from '@/lib/explainers/overview';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings · Explainers',
  robots: { index: false, follow: false },
};

export default async function ExplainersSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/');

  const loaded = await explainersDb()
    .then(loadSettingsView)
    .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));

  return (
    <div className="rh">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <p className="rh__kicker">Explainers</p>
            <h1 className="rh__title">Settings</h1>
          </div>
        </header>
        {'error' in loaded ? (
          <p className="rh-empty">Could not load settings: {loaded.error}</p>
        ) : (
          <>
            <SettingsForm initial={loaded.settings} />
            <div className="ex-settings">
              <Section title="Theme brief">
                <p className="rh-muted">
                  {loaded.settings.theme_brief_version} · E-14 · read-only. New versions are added, never edited.
                </p>
                <pre className="ex-brief">{loaded.themeBrief}</pre>
              </Section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
