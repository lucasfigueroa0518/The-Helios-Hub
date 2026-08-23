"use client";

import { Avatar } from "@/components/trello/ui/Avatar";
import { TogglePopover } from "@/components/trello/card/rail/TogglePopover";
import type { User } from "@/lib/trello/types";

type Props = {
  children: React.ReactNode;
  users: User[];
  selectedIds: string[];
  onToggle: (userId: string) => void;
};

export function MembersPicker({ children, users, selectedIds, onToggle }: Props) {
  return (
    <TogglePopover<User>
      title="Members"
      items={users}
      selectedIds={selectedIds}
      getId={(u) => u.id}
      filter={(u, q) => u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)}
      onToggle={onToggle}
      searchPlaceholder="Search members"
      emptyText="No members match."
      renderRow={(u) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={u.name} hue={u.hue} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-ink-hi">{u.name}</span>
            <span className="block truncate text-[11px] text-ink-mute">{u.role}</span>
          </span>
        </span>
      )}
    >
      {children}
    </TogglePopover>
  );
}
