"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Trash2, X } from "lucide-react";
import { cn } from "@/lib/trello/utils";
import { Avatar } from "@/components/trello/ui/Avatar";
import type { User } from "@/lib/trello/types";
import type { Workspace, WorkspaceMember } from "@/lib/trello/types";

type Role = WorkspaceMember["role"];

const ACCENTS = [
  { value: "#FF5E1A", label: "Orange" },
  { value: "#F0A64A", label: "Amber" },
  { value: "#138510", label: "Green" },
  { value: "#0079BF", label: "Blue" },
  { value: "#C377E0", label: "Purple" },
  { value: "#EB5A46", label: "Rose" },
  { value: "#5B7185", label: "Slate" },
  { value: "#2A2A2A", label: "Ink" },
] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  members: WorkspaceMember[];
  users: User[];
  meId: string;
  onRename: (name: string) => void;
  onSetAccent: (accent: string) => void;
  onDelete: () => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onSetMemberRole: (userId: string, role: Role) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
};

export function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  workspace,
  members,
  users,
  meId,
  onRename,
  onSetAccent,
  onDelete,
  onRemoveMember,
  onSetMemberRole,
  onDeleteUser,
}: Props) {
  const [name, setName] = useState(workspace.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(workspace.name);
      setConfirmDelete(false);
      setError(null);
      setBusyUserId(null);
      setDeleteBusy(false);
    }
  }, [open, workspace.id, workspace.name]);

  // Caller's role within this workspace — governs what actions render
  // per row. Owner sees everything, admin sees remove for plain members
  // only, everyone else gets read-only.
  const myRole: Role | null = useMemo(() => {
    return (
      members.find((m) => m.workspaceId === workspace.id && m.userId === meId)
        ?.role ?? null
    );
  }, [members, workspace.id, meId]);

  const workspaceMembers = useMemo(() => {
    const rows = members.filter((m) => m.workspaceId === workspace.id);
    // Sort: owners → admins → members → guests, then by joinedAt asc.
    const order: Record<Role, number> = { owner: 0, admin: 1, member: 2, guest: 3 };
    return rows.slice().sort((a, b) => {
      const d = order[a.role] - order[b.role];
      if (d !== 0) return d;
      return a.joinedAt.localeCompare(b.joinedAt);
    });
  }, [members, workspace.id]);

  const otherOwnerCount = useMemo(
    () =>
      workspaceMembers.filter(
        (m) => m.role === "owner" && m.userId !== meId,
      ).length,
    [workspaceMembers, meId],
  );

  function commitRename() {
    const t = name.trim();
    if (!t || t === workspace.name) return;
    onRename(t);
  }

  async function handleDelete() {
    if (deleteBusy) return;
    setError(null);
    setDeleteBusy(true);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the workspace.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleRemove(userId: string) {
    if (busyUserId) return;
    setError(null);
    setBusyUserId(userId);
    try {
      await onRemoveMember(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that member.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleSetRole(userId: string, role: Role) {
    if (busyUserId) return;
    setError(null);
    setBusyUserId(userId);
    try {
      await onSetMemberRole(userId, role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change role.");
    } finally {
      setBusyUserId(null);
    }
  }

  const canManageMembers = myRole === "owner" || myRole === "admin";
  const canChangeRoles = myRole === "owner";
  const canDelete = myRole === "owner";
  const canRename = myRole === "owner" || myRole === "admin";

  // "Other accounts" section — every user in the roster who isn't a
  // member of this workspace. That's where the test accounts Tommy
  // signed in as end up, since they're their own workspace's owners
  // but not members of anyone else's. Owner-only surface.
  const workspaceMemberIds = useMemo(
    () => new Set(workspaceMembers.map((m) => m.userId)),
    [workspaceMembers],
  );
  const otherUsers = useMemo(
    () =>
      users
        .filter((u) => u.id !== meId && !workspaceMemberIds.has(u.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, workspaceMemberIds, meId],
  );

  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);

  async function handleDeleteUser(userId: string) {
    if (busyUserId) return;
    setError(null);
    setBusyUserId(userId);
    try {
      await onDeleteUser(userId);
      setConfirmDeleteUserId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete that account.");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="fixed inset-0 z-50 bg-black/40"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                initial={{ opacity: 0, x: "-50%", y: "calc(-50% + 8px)", scale: 0.985 }}
                animate={{ opacity: 1, x: "-50%", y: "-50%", scale: 1 }}
                exit={{ opacity: 0, x: "-50%", y: "calc(-50% + 4px)", scale: 0.99 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[520px] overflow-hidden rounded-[14px] surface-modal shadow-modal"
              >
                <div className="flex items-start justify-between px-5 pt-5 pb-3">
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="font-display text-[16px] text-ink-hi">
                      Workspace settings
                    </Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-[12.5px] text-ink-mute">
                      Managing {workspace.name}. Your role:{" "}
                      <span className="font-medium capitalize text-ink-mid">
                        {myRole ?? "guest"}
                      </span>
                      .
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      className="rounded p-1 text-ink-mute hover:bg-neutral-50 hover:text-ink-mid transition-colors"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="max-h-[calc(85vh-64px)] overflow-y-auto px-5 pb-5">
                  {/* Name + accent */}
                  <section>
                    <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                      Name
                    </div>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                          (e.target as HTMLInputElement).blur();
                        }
                        if (e.key === "Escape") setName(workspace.name);
                      }}
                      disabled={!canRename}
                      className={cn(
                        "w-full rounded-[8px] border border-neutral-200 bg-white px-3 py-2 text-[13.5px] text-ink-hi outline-none transition-colors focus:border-helios-500/60",
                        !canRename && "cursor-not-allowed opacity-60",
                      )}
                    />

                    <div className="mb-2 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                      Accent
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {ACCENTS.map((a) => {
                        const active =
                          workspace.accent.toLowerCase() === a.value.toLowerCase();
                        return (
                          <button
                            key={a.value}
                            type="button"
                            onClick={() => canRename && onSetAccent(a.value)}
                            disabled={!canRename}
                            className={cn(
                              "grid h-7 w-7 place-items-center rounded-full outline-none transition-transform hover:scale-110",
                              active &&
                                "ring-2 ring-offset-2 ring-offset-white ring-ink-hi",
                              !canRename && "cursor-not-allowed opacity-60",
                            )}
                            style={{ background: a.value }}
                            aria-label={a.label}
                            title={a.label}
                          >
                            {active && (
                              <Check
                                className="h-3.5 w-3.5 text-white"
                                strokeWidth={3}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  {/* Members */}
                  <section className="mt-6">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                        Members
                      </span>
                      <span className="text-[11px] tabular-nums text-ink-mute">
                        {workspaceMembers.length}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {workspaceMembers.map((m) => {
                        const user = users.find((u) => u.id === m.userId);
                        if (!user) return null;
                        const isMe = m.userId === meId;
                        // Rules per Fig-approved model:
                        //  - Owner: can do anything except leave last owner behind.
                        //  - Admin: can remove members only.
                        //  - Nobody can act on themselves via this UI.
                        const canRemoveThis =
                          canManageMembers &&
                          !isMe &&
                          (myRole === "owner"
                            ? m.role !== "owner" ||
                              otherOwnerCount >= 1
                            : m.role === "member" || m.role === "guest");
                        const canPromoteThis =
                          canChangeRoles && !isMe && m.role === "member";
                        const canDemoteThis =
                          canChangeRoles &&
                          !isMe &&
                          m.role === "admin";
                        return (
                          <li key={m.id}>
                            <div className="flex items-center gap-3 rounded-[8px] border border-neutral-100 px-3 py-2 transition-colors hover:bg-neutral-50">
                              <Avatar
                                name={user.name}
                                hue={user.hue}
                                size="md"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="truncate text-[13.5px] font-medium text-ink-hi">
                                    {user.name}
                                    {isMe && (
                                      <span className="ml-1.5 text-[11px] font-normal text-ink-mute">
                                        you
                                      </span>
                                    )}
                                  </span>
                                </div>
                                {user.role && (
                                  <div className="truncate text-[11.5px] text-ink-mute">
                                    {user.role}
                                  </div>
                                )}
                              </div>
                              <RoleBadge role={m.role} />
                              <div className="flex items-center gap-1">
                                {canPromoteThis && (
                                  <button
                                    onClick={() =>
                                      handleSetRole(m.userId, "admin")
                                    }
                                    disabled={busyUserId === m.userId}
                                    className="rounded-[6px] px-2 py-1 text-[11.5px] text-ink-mid transition-colors hover:bg-neutral-100 hover:text-ink-hi disabled:opacity-50"
                                    title="Promote to admin"
                                  >
                                    Make admin
                                  </button>
                                )}
                                {canDemoteThis && (
                                  <button
                                    onClick={() =>
                                      handleSetRole(m.userId, "member")
                                    }
                                    disabled={busyUserId === m.userId}
                                    className="rounded-[6px] px-2 py-1 text-[11.5px] text-ink-mid transition-colors hover:bg-neutral-100 hover:text-ink-hi disabled:opacity-50"
                                    title="Demote to member"
                                  >
                                    Demote
                                  </button>
                                )}
                                {canRemoveThis && (
                                  <button
                                    onClick={() => handleRemove(m.userId)}
                                    disabled={busyUserId === m.userId}
                                    className="grid h-7 w-7 place-items-center rounded-[6px] text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                                    title="Remove from workspace"
                                    aria-label={`Remove ${user.name}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>

                  {/* Other accounts — owner-only cleanup surface for
                      users who aren't in this workspace (leftover
                      test-signin accounts, etc). Nukes the whole
                      account server-side. */}
                  {myRole === "owner" && otherUsers.length > 0 && (
                    <section className="mt-6">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                          Other accounts
                        </span>
                        <span className="text-[11px] tabular-nums text-ink-mute">
                          {otherUsers.length}
                        </span>
                      </div>
                      <p className="mb-3 text-[11.5px] leading-[1.45] text-ink-mute">
                        Users in the system who aren&apos;t members here.
                        Delete removes the account and everything they
                        own — permanent.
                      </p>
                      <ul className="flex flex-col gap-1">
                        {otherUsers.map((u) => {
                          const confirming = confirmDeleteUserId === u.id;
                          const busy = busyUserId === u.id;
                          return (
                            <li key={u.id}>
                              <div className="flex items-center gap-3 rounded-[8px] border border-neutral-100 px-3 py-2">
                                <Avatar
                                  name={u.name}
                                  hue={u.hue}
                                  size="md"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[13.5px] font-medium text-ink-hi">
                                    {u.name || (
                                      <span className="italic text-ink-mute">
                                        (no name)
                                      </span>
                                    )}
                                  </div>
                                  {u.role && (
                                    <div className="truncate text-[11.5px] text-ink-mute">
                                      {u.role}
                                    </div>
                                  )}
                                </div>
                                {confirming ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => setConfirmDeleteUserId(null)}
                                      disabled={busy}
                                      className="rounded-[6px] px-2 py-1 text-[11.5px] text-ink-mid transition-colors hover:bg-neutral-100 hover:text-ink-hi disabled:opacity-50"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => handleDeleteUser(u.id)}
                                      disabled={busy}
                                      className="rounded-[6px] bg-danger px-2 py-1 text-[11.5px] font-medium text-white transition-colors hover:brightness-110 disabled:opacity-60"
                                    >
                                      {busy ? "Deleting…" : "Confirm"}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() =>
                                      setConfirmDeleteUserId(u.id)
                                    }
                                    disabled={busy}
                                    className="rounded-[6px] border border-danger/25 bg-white px-2.5 py-1 text-[11.5px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                                  >
                                    Delete account
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  {/* Danger zone */}
                  {canDelete && (
                    <section className="mt-6 rounded-[10px] border border-danger/15 bg-danger/[0.03] p-3">
                      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-danger">
                        Danger zone
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <p className="max-w-[320px] text-[12px] leading-[1.4] text-ink-mid">
                          Deleting the workspace removes every board, list,
                          card, comment, and file inside it. This can&apos;t be
                          undone.
                        </p>
                        {!confirmDelete ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            className="shrink-0 rounded-[6px] border border-danger/30 bg-white px-3 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/10"
                          >
                            Delete workspace
                          </button>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(false)}
                              disabled={deleteBusy}
                              className="rounded-[6px] px-2 py-1.5 text-[12px] text-ink-mid hover:bg-neutral-50 hover:text-ink-hi transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleDelete}
                              disabled={deleteBusy}
                              className="rounded-[6px] bg-danger px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:brightness-110 disabled:opacity-60"
                            >
                              {deleteBusy ? "Deleting…" : "Confirm delete"}
                            </button>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {error && (
                    <div className="mt-3 rounded-[6px] bg-danger/10 px-3 py-2 text-[12px] text-danger">
                      {error}
                    </div>
                  )}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const style: Record<Role, string> = {
    owner: "bg-helios-500/10 text-helios-500",
    admin: "bg-heliosGreen-600/12 text-heliosGreen-600",
    member: "bg-neutral-100 text-ink-mid",
    guest: "bg-neutral-100 text-ink-mute",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]",
        style[role],
      )}
    >
      {role}
    </span>
  );
}
