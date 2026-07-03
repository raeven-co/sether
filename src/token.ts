// Canonical shape of a redaction token: `<TYPE_uuid>`, where TYPE is the
// detector type (uppercase ASCII identifier) and the body is the hex/dash
// UUID from the redact path. This single source of truth is shared by every
// restore path (streaming, sync, SSE, and the middlewares) so the accepted
// token grammar cannot drift between them again — before consolidation the
// streaming restore required the type to start with a letter while the sync
// paths also accepted a leading underscore.
//
// The regex is `g`-flagged and intended for `String.prototype.replace`,
// which resets `lastIndex` itself. If you use it with `.exec()` in a loop,
// reset `lastIndex` first, as the detector modules do with their own regexes.
export const TOKEN_RE = /<[A-Z_][A-Z0-9_]*_[0-9a-fA-F-]{8,}>/g;
