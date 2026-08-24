"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/trello/ui/Avatar";
import { matchesUserLookup } from "@/lib/trello/workspace-access";
import type { User } from "@/lib/trello/types";

type Props = {
  users: User[];
  onSelect: (user: User) => void;
  busy?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  autoFocus?: boolean;
};

export function UserLookup({
  users,
  onSelect,
  busy,
  placeholder = "Search people",
  emptyLabel = "No one left to add.",
  autoFocus = true,
}: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => users.filter((u) => matchesUserLookup(u, query)),
    [users, query],
  );

  if (users.length === 0) {
    return <p className="px-1 py-2 text-[12px] text-ink-mute">{emptyLabel}</p>;
  }

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="mb-1.5 w-full rounded-[6px] border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[13px] text-ink-hi outline-none focus:border-helios-500/60"
      />
      <ul className="max-h-52 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="px-1 py-2 text-[12px] text-ink-mute">No matching people.</li>
        ) : (
          filtered.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSelect(user)}
                className="flex w-full items-center gap-2.5 rounded-[6px] px-1.5 py-1.5 text-left transition-colors hover:bg-neutral-50 disabled:opacity-50"
              >
                <Avatar name={user.name} hue={user.hue} size="sm" tooltip={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink-hi">{user.name}</span>
                  {user.email ? (
                    <span className="block truncate text-[11px] text-ink-mute">{user.email}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
