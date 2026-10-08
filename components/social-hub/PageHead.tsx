import type { ReactNode } from 'react';

export function PageHead({ kicker, title, sub, actions }: { kicker: string; title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sh-head">
      <div>
        <p className="sh-head__kicker">{kicker}</p>
        <h1 className="sh-head__title">{title}</h1>
        {sub ? <p className="sh-head__sub">{sub}</p> : null}
      </div>
      {actions ? <div className="sh-head__actions">{actions}</div> : null}
    </header>
  );
}
