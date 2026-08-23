/**
 * Non-server module for constants shared between the client hook and
 * server actions. Server-action files (`"use server"`) can only export
 * async functions — sharing a plain array from one violates that
 * rule and crashes the whole page render, so any board-wide default
 * that isn't a function lives here.
 */

/** Default lists for every new board — matches Trello's shape. */
export const DEFAULT_LIST_NAMES = ["To do", "In progress", "Done"] as const;
