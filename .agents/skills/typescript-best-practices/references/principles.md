# Type-system and boundary principles

Adapted from Cursor pstack's `principle-type-system-discipline` and `principle-boundary-discipline`, under the accompanying MIT [LICENSE](../LICENSE). Sources are pinned in the installation manifest.

- Model mutually exclusive states as variants and handle each variant exhaustively. Strengthen a type where an operation would otherwise be partial; do not add type machinery without a concrete invariant.
- Distinguish primitives with different domain meanings where interchange would cause a mistake. Validate raw values when creating the domain value; a type assertion is not validation.
- Parse external data at network, filesystem, database, configuration, and user-input boundaries. Reuse the repository's runtime schemas and derive types from their authoritative definition.
- Keep framework and storage representations within adapters. Domain operations consume domain values. Pure transformations make prompt assembly and scoring easier to verify.
- Trust established internal invariants, but revalidate when data crosses another trust boundary or mutable state can invalidate the claim. A previously parsed value does not authorize a later external action.
- Treat numeric constraints separately from structural types: a `number` admits negative and non-finite values. Enforce the required invariant at construction or with a validated domain representation.
