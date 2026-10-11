import type { ReactNode } from 'react';

/** Page title (Pragmatica, once per page) with one quiet meta line. No eyebrow (DESIGN.md, The No Eyebrow Rule). */
export function PageHead({ title, aside, meta, actions, before, after }: { title: string; aside?: string; meta?: ReactNode; actions?: ReactNode; /** Controls beside the title (the Content page's day arrows). */ before?: ReactNode; after?: ReactNode }) {
  return (
    <header className="sh-head">
      <div className="sh-head__text">
        <h1 className="sh-head__title">
          {before}
          {title}
          {aside ? <small>{aside}</small> : null}
          {after}
        </h1>
        {meta ? <p className="sh-head__meta">{meta}</p> : null}
      </div>
      {actions ? <div className="sh-head__actions">{actions}</div> : null}
    </header>
  );
}
