/**
 * Canonical shape of a redaction token: `<TYPE_uuid>`, where TYPE is the
 * detector type (uppercase ASCII identifier) and the body is the hex/dash
 * UUID from the redact path. This single source of truth is shared by every
 * restore path (streaming, sync, SSE, and the middlewares) so the accepted
 * token grammar cannot drift between them again — before consolidation the
 * streaming restore required the type to start with a letter while the sync
 * paths also accepted a leading underscore.
 *
 * Exported from the package root so callers can find tokens without mirroring
 * the pattern. It is `g`-flagged and intended for `String.prototype.replace` /
 * `match`, which reset `lastIndex` themselves. If you use it with `.exec()` or
 * `.test()`, reset `lastIndex` first or build your own copy, e.g.
 * `new RegExp('^' + TOKEN_RE.source + '$')` for an exact-match check.
 */
export const TOKEN_RE = /<[A-Z_][A-Z0-9_]*_[0-9a-fA-F-]{8,}>/g;
