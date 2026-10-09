/**
 * The one Graph API version every content type calls. Pinned rather than
 * unversioned, which would silently follow the app's default. v26.0 shipped
 * 2026-07-29 and is current as of 2026-09-27. Constants only, so config files
 * (and the hub's read code) can name it without importing the Graph client.
 */
export const META_GRAPH_VERSION = 'v26.0';
