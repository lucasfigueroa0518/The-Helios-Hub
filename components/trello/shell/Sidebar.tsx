"use client";

import { useState } from "react";
import Image from "next/image";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/trello/utils";
import { savedViews, type Board, type User } from "@/lib/trello/types";
import { Avatar } from "@/components/trello/ui/Avatar";
import { CalendarDays, Activity, User as UserIcon, Plus, PanelLeftClose, Archive, LogOut, ChevronDown, Check, Settings } from "lucide-react";
import type { ActiveView } from "@/lib/trello/useBoardState";
import type { Workspace, WorkspaceMember } from "@/lib/trello/types";
import { motion, LayoutGroup } from "framer-motion";
import { signOut } from "next-auth/react";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { WorkspaceSettingsDialog } from "./WorkspaceSettingsDialog";

type Props = {
  boards: Board[];
  users: User[];
  me: User;
  workspaces: Workspace[];
  workspaceMembers: WorkspaceMember[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string, description: string) => Promise<string>;
  onRenameWorkspace: (id: string, name: string) => void;
  onSetWorkspaceAccent: (id: string, accent: string) => void;
  onDeleteWorkspace: (id: string) => Promise<void>;
  onRemoveWorkspaceMember: (workspaceId: string, userId: string) => Promise<void>;
  onSetWorkspaceMemberRole: (
    workspaceId: string,
    userId: string,
    role: WorkspaceMember["role"],
  ) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
  activeBoardId: string;
  activeView: ActiveView;
  onSelectBoard: (id: string) => void;
  onSelectView: (id: ActiveView) => void;
  cardCountsByBoard: Record<string, number>;
  viewCounts: { sv_mine: number; sv_week: number; sv_activity: number };
  onCollapse?: () => void;
  onNewBoard: () => void;
};

// Map savedView ids to their sidebar icon. Order in seed = Mine, Week, Activity.
// Profile isn't in the Views list — it's opened from the pinned-user card.
// Home isn't in Views either — it's the workspace mark up top.
const viewIcons: Record<ActiveView, typeof UserIcon> = {
  home: UserIcon,
  board: UserIcon,
  sv_mine: UserIcon,
  sv_week: CalendarDays,
  sv_activity: Activity,
  sv_archive: Archive,
  sv_profile: UserIcon,
};

/**
 * A single shared `layoutId="nav-active"` runs through every nav tile so
 * the active-state highlight physically slides between them when you
 * switch. Nav tiles use motion.div so we can whileHover them for a
 * quiet 1px indent that reads as "this is a control" without shouting.
 */
const activeSpring = { type: "spring", stiffness: 500, damping: 38, mass: 0.7 } as const;

export function Sidebar({
  boards,
  users,
  me,
  workspaces,
  workspaceMembers,
  activeWorkspaceId,
  onSwitchWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onSetWorkspaceAccent,
  onDeleteWorkspace,
  onRemoveWorkspaceMember,
  onSetWorkspaceMemberRole,
  onDeleteUser,
  activeBoardId,
  activeView,
  onSelectBoard,
  onSelectView,
  cardCountsByBoard,
  viewCounts,
  onCollapse,
  onNewBoard,
}: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [settingsForWorkspaceId, setSettingsForWorkspaceId] = useState<string | null>(null);
  const settingsWorkspace = settingsForWorkspaceId
    ? workspaces.find((w) => w.id === settingsForWorkspaceId) ?? null
    : null;
  const myRoleByWorkspace: Record<string, WorkspaceMember["role"]> = {};
  for (const wm of workspaceMembers) {
    if (wm.userId === me.id) myRoleByWorkspace[wm.workspaceId] = wm.role;
  }
  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  // `users` is passed for future multi-member UI; solo mode uses only `me`.
  void users;

  return (
    <aside className="flex h-screen w-[248px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-white/10 dark:bg-neutral-950">
      {/* Workspace mark — clicks nav home to the workspaces hero.
          Chevron next to it opens a switcher popover. */}
      <div className="flex items-center justify-between px-5 pt-5 pb-6">
        <div className="flex min-w-0 items-center gap-1">
          <motion.button
            onClick={() => onSelectView("home")}
            whileHover={{ y: -0.5 }}
            whileTap={{ scale: 0.98 }}
            transition={activeSpring}
            className={cn(
              "flex min-w-0 items-center gap-2.5 outline-none",
              "focus-visible:ring-2 focus-visible:ring-helios-500/50 rounded-[8px] -mx-1 px-1 py-0.5"
            )}
            aria-label="Go to workspace home"
          >
            <span
              className={cn(
                "relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full",
                "shadow-[0_1px_6px_-2px_rgba(255,94,26,0.22)]",
                activeView === "home" && "ring-2 ring-helios-500/60 ring-offset-2 ring-offset-neutral-50"
              )}
            >
              <Image
                src="/trello/helios-logo-sm.png"
                alt="Helios"
                width={32}
                height={32}
                priority
                className="h-8 w-8 select-none object-cover"
                draggable={false}
              />
            </span>
            <span className="flex min-w-0 flex-col text-left">
              <span className="truncate text-[13.5px] font-semibold text-ink-hi">
                {activeWorkspace?.name ?? "Workspace"}
              </span>
              <span className="text-[11px] text-ink-mute">
                {activeView === "home" ? "Home" : "Workspace"}
              </span>
            </span>
          </motion.button>

          <Popover.Root open={switcherOpen} onOpenChange={setSwitcherOpen}>
            <Popover.Trigger asChild>
              <button
                className={cn(
                  "shrink-0 grid h-6 w-6 place-items-center rounded-[6px] text-ink-mute transition-colors",
                  "hover:bg-neutral-100 hover:text-ink-hi",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-helios-500/50",
                  "data-[state=open]:bg-neutral-100 data-[state=open]:text-ink-hi",
                )}
                aria-label="Switch workspace"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="start"
                sideOffset={6}
                className="z-[60] w-64 overflow-hidden rounded-[10px] surface-modal p-1.5 shadow-modal outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40"
              >
                <motion.div
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                    Workspaces
                  </div>
                  <ul className="flex flex-col">
                    {workspaces.map((w) => {
                      const isActive = w.id === activeWorkspaceId;
                      const owned = w.ownerId === me.id;
                      const myRole = myRoleByWorkspace[w.id];
                      const canManage = myRole === "owner" || myRole === "admin";
                      return (
                        <li key={w.id} className="group/wsrow">
                          <div
                            className={cn(
                              "flex items-center gap-1 rounded-[6px] transition-colors",
                              isActive ? "bg-neutral-100" : "hover:bg-neutral-50",
                            )}
                          >
                            <button
                              onClick={() => {
                                onSwitchWorkspace(w.id);
                                setSwitcherOpen(false);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40"
                            >
                              <span
                                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold uppercase text-white"
                                style={{
                                  background: `linear-gradient(135deg, ${w.accent}, ${shadeHex(w.accent, -0.22)})`,
                                }}
                              >
                                {w.name.slice(0, 1)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] text-ink-hi">
                                  {w.name}
                                </span>
                                {!owned && (
                                  <span className="block truncate text-[10.5px] text-ink-mute">
                                    Shared
                                  </span>
                                )}
                              </span>
                              {isActive && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-helios-500" strokeWidth={2.5} />
                              )}
                            </button>
                            {canManage && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSettingsForWorkspaceId(w.id);
                                  setSwitcherOpen(false);
                                }}
                                className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-ink-mute opacity-0 transition-opacity hover:bg-neutral-100 hover:text-ink-hi focus-visible:opacity-100 group-hover/wsrow:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40"
                                aria-label={`Settings for ${w.name}`}
                                title="Workspace settings"
                              >
                                <Settings className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="my-1 h-px bg-neutral-100" />
                  <button
                    onClick={() => {
                      setSwitcherOpen(false);
                      setNewWorkspaceOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] text-ink-mid transition-colors hover:bg-neutral-50 hover:text-ink-hi"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New workspace
                  </button>
                </motion.div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        {onCollapse && (
          <motion.button
            onClick={onCollapse}
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            transition={activeSpring}
            className={cn(
              "grid h-7 w-7 place-items-center rounded-full text-ink-low outline-none",
              "transition-colors hover:bg-neutral-100 hover:text-ink-hi",
              "focus-visible:ring-2 focus-visible:ring-helios-500/50"
            )}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </motion.button>
        )}
      </div>

      <LayoutGroup id="sidebar-nav">
        <nav className="flex-1 overflow-y-auto px-2.5">
          <SectionLabel>Your boards</SectionLabel>
          <ul className="mt-1.5 space-y-0.5">
            {boards.map((b) => {
              const active = activeView === "board" && b.id === activeBoardId;
              return (
                <NavTile
                  key={b.id}
                  active={active}
                  onClick={() => onSelectBoard(b.id)}
                  leading={
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ background: b.accent }}
                    />
                  }
                  label={b.name}
                  trailing={
                    <span className="text-[11px] tabular-nums text-ink-mute">
                      {cardCountsByBoard[b.id] ?? 0}
                    </span>
                  }
                />
              );
            })}
            <NavTile
              onClick={onNewBoard}
              leading={<Plus className="h-3.5 w-3.5" />}
              label="New board"
              muted
            />
          </ul>

          <SectionLabel className="mt-6">Views</SectionLabel>
          <ul className="mt-1.5 space-y-0.5">
            {savedViews.map((v) => {
              const id = v.id as ActiveView;
              const Icon = viewIcons[id] ?? Activity;
              const active = activeView === id;
              const count = viewCounts[id as keyof typeof viewCounts];
              return (
                <NavTile
                  key={v.id}
                  active={active}
                  onClick={() => onSelectView(id)}
                  leading={
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 transition-colors duration-150",
                        active ? "text-helios-300" : ""
                      )}
                    />
                  }
                  label={v.name}
                  trailing={
                    typeof count === "number" && count > 0 ? (
                      <span
                        className={cn(
                          "text-[11px] tabular-nums transition-colors duration-150",
                          active ? "text-helios-300" : "text-ink-mute"
                        )}
                      >
                        {count}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </ul>
        </nav>
      </LayoutGroup>

      {/* Pinned user — opens the profile view when clicked. The sign-out
          button lives alongside the pill (not inside — nested buttons
          are invalid HTML) so it can steal its own click without
          fighting the profile-nav gesture. */}
      <div className="border-t border-neutral-200 px-3 pb-4 pt-3">
        <div className="group/user flex items-center gap-1.5">
          <motion.button
            onClick={() => onSelectView("sv_profile")}
            whileHover={{ scale: 1.005 }}
            whileTap={{ scale: 0.985 }}
            transition={activeSpring}
            className={cn(
              "relative flex flex-1 min-w-0 items-center gap-2.5 rounded-[8px] px-2 py-1.5",
              "outline-none focus-visible:ring-2 focus-visible:ring-helios-500/50",
              activeView === "sv_profile" ? "text-ink-hi" : "hover:bg-neutral-50"
            )}
          >
            {activeView === "sv_profile" && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-[8px] bg-neutral-100"
                transition={activeSpring}
              />
            )}
            <span className="relative z-10">
              <Avatar name={me.name} hue={me.hue} size="md" />
            </span>
            <div className="relative z-10 min-w-0 flex-1 text-left">
              <div className="truncate text-[13px] font-medium text-ink-hi">
                {me.name}
              </div>
              <div className="truncate text-[11px] text-ink-mute">{me.role}</div>
            </div>
            <span className="relative z-10 h-2 w-2 shrink-0">
              <span className="absolute inset-0 rounded-full bg-heliosGreen-400" />
              <motion.span
                className="absolute inset-0 rounded-full bg-heliosGreen-400"
                animate={{ scale: [1, 2.2, 1], opacity: [0.5, 0, 0.5] }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
              />
            </span>
          </motion.button>
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signOut({ callbackUrl: '/' })}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-ink-mute opacity-0 transition-all group-hover/user:opacity-100 focus-visible:opacity-100 hover:bg-neutral-100 hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-helios-500/50"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <NewWorkspaceDialog
        open={newWorkspaceOpen}
        onOpenChange={setNewWorkspaceOpen}
        onCreate={async (name, description) => {
          await onCreateWorkspace(name, description);
        }}
      />

      {settingsWorkspace && (
        <WorkspaceSettingsDialog
          open={!!settingsForWorkspaceId}
          onOpenChange={(open) => !open && setSettingsForWorkspaceId(null)}
          workspace={settingsWorkspace}
          members={workspaceMembers}
          users={users}
          meId={me.id}
          onRename={(name) => onRenameWorkspace(settingsWorkspace.id, name)}
          onSetAccent={(accent) =>
            onSetWorkspaceAccent(settingsWorkspace.id, accent)
          }
          onDelete={() => onDeleteWorkspace(settingsWorkspace.id)}
          onAddMember={async () => {}}
          onRemoveMember={(userId) =>
            onRemoveWorkspaceMember(settingsWorkspace.id, userId)
          }
          onSetMemberRole={(userId, role) =>
            onSetWorkspaceMemberRole(settingsWorkspace.id, userId, role)
          }
          onDeleteUser={onDeleteUser}
        />
      )}
    </aside>
  );
}

/**
 * Shared nav-tile primitive. The active highlight is a motion.span
 * with a shared layoutId — Framer springs it between tiles when the
 * active target changes, so switching from a board to a View glides
 * the pill instead of blink-hopping.
 */
function NavTile({
  active,
  onClick,
  leading,
  label,
  trailing,
  muted,
}: {
  active?: boolean;
  onClick: () => void;
  leading: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <li>
      <motion.button
        onClick={onClick}
        whileHover={{ x: 1 }}
        whileTap={{ scale: 0.985 }}
        transition={activeSpring}
        className={cn(
          "relative flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left outline-none",
          "transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-helios-500/50",
          active
            ? "text-ink-hi"
            : muted
              ? "text-ink-mute hover:text-ink-mid"
              : "text-ink-low hover:text-ink-hi",
          !active && "hover:bg-neutral-50"
        )}
      >
        {active && (
          <motion.span
            layoutId="nav-active"
            className="absolute inset-0 rounded-[6px] bg-neutral-100"
            transition={activeSpring}
          />
        )}
        <span className="relative z-10 flex items-center justify-center">
          {leading}
        </span>
        <span className="relative z-10 flex-1 text-[13.5px]">{label}</span>
        {trailing && <span className="relative z-10">{trailing}</span>}
      </motion.button>
    </li>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-mute",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Darken/lighten a #RRGGBB by amount in [-1,1]. Falls through if the
 *  input isn't a clean hex. */
function shadeHex(hex: string, amount: number): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const hex2 = (n: number) => n.toString(16).padStart(2, "0");
  const r = clamp(parseInt(m[1], 16) + Math.round(255 * amount));
  const g = clamp(parseInt(m[2], 16) + Math.round(255 * amount));
  const b = clamp(parseInt(m[3], 16) + Math.round(255 * amount));
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}
