"use client";

import { cn } from "@/lib/trello/utils";

/**
 * Wireframe placeholder for the app shell — sidebar + topbar + home
 * grid. Matches the actual layout closely enough that the transition
 * to real UI is a fade rather than a jump. Colors are neutral (no
 * helios orange) so it reads as "structural" not "branded loading".
 *
 * Deliberately no copy — a skeleton with words ("Loading…", "Please
 * wait") tips into "something's wrong" the second it lingers past 2s.
 * A silent wireframe just reads as pre-hydration state.
 */
export function WorkspaceSkeleton() {
  return (
    <div className="flex h-screen bg-white text-transparent select-none">
      {/* Sidebar */}
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
        {/* Workspace mark row */}
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
          <Shimmer className="h-8 w-8 rounded-full" />
          <Shimmer className="h-3.5 w-24 rounded-full" />
        </div>

        <div className="px-2.5">
          <SectionLabel width="60px" />
          <div className="mt-2 space-y-1.5">
            <NavRow />
            <NavRow />
            <NavRow muted />
          </div>

          <SectionLabel width="42px" className="mt-6" />
          <div className="mt-2 space-y-1.5">
            <NavRow />
            <NavRow />
            <NavRow />
          </div>
        </div>

        <div className="mt-auto px-2.5 pb-5">
          <div className="flex items-center gap-2.5 rounded-[10px] bg-white/60 px-3 py-2.5">
            <Shimmer className="h-7 w-7 rounded-full" />
            <div className="flex-1 space-y-1">
              <Shimmer className="h-2.5 w-20 rounded-full" />
              <Shimmer className="h-2 w-14 rounded-full" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <div className="flex h-14 items-center gap-3 border-b border-neutral-200 px-5">
          <Shimmer className="h-4 w-40 rounded-full" />
          <div className="flex-1" />
          <Shimmer className="h-8 w-[240px] rounded-full" />
          <Shimmer className="h-7 w-7 rounded-full" />
          <Shimmer className="h-7 w-7 rounded-full" />
        </div>

        {/* Home-style content: two rows of card-tiles */}
        <div className="flex-1 overflow-hidden px-8 pt-8">
          <SectionLabel width="140px" />
          <div className="mt-4 grid grid-cols-4 gap-4">
            <TileShimmer />
            <TileShimmer />
            <TileShimmer />
            <TileShimmer />
          </div>

          <SectionLabel width="160px" className="mt-10" />
          <div className="mt-3 flex items-center gap-2">
            <Shimmer className="h-6 w-6 rounded-md" />
            <Shimmer className="h-4 w-32 rounded-full" />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            <TileShimmer />
            <TileShimmer />
            <TileShimmer />
          </div>
        </div>
      </div>
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "block bg-neutral-200/70 animate-pulse",
        className,
      )}
    />
  );
}

function SectionLabel({ width, className }: { width: string; className?: string }) {
  return (
    <div className={cn("px-2.5", className)}>
      <span
        className="block h-2 rounded-full bg-neutral-200/70 animate-pulse"
        style={{ width }}
      />
    </div>
  );
}

function NavRow({ muted }: { muted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-1.5">
      <Shimmer className={cn("h-2 w-2 rounded-sm", muted && "opacity-50")} />
      <Shimmer className="h-2.5 flex-1 max-w-[120px] rounded-full" />
    </div>
  );
}

function TileShimmer() {
  return (
    <div className="relative aspect-[16/9] overflow-hidden rounded-[10px] bg-neutral-100">
      <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-neutral-200/60 via-neutral-100/40 to-neutral-200/60" />
    </div>
  );
}
