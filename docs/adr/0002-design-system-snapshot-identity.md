# 0002. Design system snapshot identity, activation, and authority

## Status

Proposed - not Accepted. The direction is recorded as endorsed by the owner for
planning; formal acceptance is withheld pending the blocking open questions
O1-O8. Endorsement is not acceptance, and this ADR must not be cited as an
accepted contract. No part of it is implemented. This ADR is documentation only:
it changes no code, workflow, installer, installation, or distribution, and it
does not promote the proof-of-concept.

The decisions D1-D4 below are canonical and are restated without silent
reinterpretation. Any change to them requires an explicit amendment to this ADR,
not an implementation decision or a PR-side reinterpretation. O1-O8 record
points where the written direction has not yet been reconciled with those
decisions or with itself. They do not reopen D1-D4, but acceptance cannot claim
that D1-D4 are consistently applied until they are resolved. Where O1-O8
describe competing readings, this ADR does not assert which reading the owner
endorsed.

## Context

### B2-3 documents are partially delivered

B2-3 declares that `design-system/DESIGN.md` and `design-system/USAGE.md` are
edited in DesignOps and that the installed copy is a derived destination.
Internal DesignOps PR #7 delivered the reconciled master documents and the
provenance and structural checkers, but not the whole workstream:

- `baseline.sha256` covers five generated artifacts only; it does not cover
  `DESIGN.md`, `USAGE.md`, `README.md`, `manifest.json`, or `preview/`.
- Provenance verification has fixtures but was not run against the real package.
- Copying or regenerating the package into the installation was not executed.
- The installed documents remain pre-B2-3 drift (different content, not an older
  revision of the master).
- An incidental adapter run rewrote three generated JSON artifacts. The incident
  was contained, not remediated: the installation is frozen, not approved, and
  not presented as intact.

B2-3 stays open. This ADR does not close it, sync the installation, or transfer
its remaining work.

### Runtime package identity does not exist

The current runtime identifies a design system by a reusable public name, not by
package identity. A bare id resolves across roots in a fixed order, assets are
merged per field between builtin and user packages, a team mirror keeps the same
logical id as the personal copy, and the catalog can hide the second entry.
Therefore one name can resolve to different byte trees, and two legitimate
packages can share one name. No hash of path, name, or content repairs this: the
identity must be assigned.

### Reading is not generation-atomic and not authority-checked end to end

Resolving a mutable pointer separately per consumer can pair documents from
generation A with assets from generation B. A hash checked before a consumer
reopens a path does not cover the bytes the consumer finally reads. Workspace
and member headers attribute context but are not authentication, and a local
binding can still be written from header attribution.

### The review found unresolved contradictions

A review of the candidate design found eight tensions that the text states as
settled but does not reconcile: the activation flag versus D1, bootstrap
authority, installation-scope move and clone, the mirror owner namespace, one
generation store versus per-materialization copies, alias precedence,
descriptor digest canonicalization, and cleanup versus the no-GC claim. They are
recorded as O1-O8 and block acceptance.

Daemon data-root rules are not restated here. They live only in root
[`AGENTS.md`](../../AGENTS.md) → **Daemon data directory contract**.

## Decision

The endorsed direction is an immutable, verified, in-memory generation snapshot
for design-system documents and assets, with a closed inventory, server
authority, a durable mode per `(installationScope, canonicalPackageKey)`,
Run-scoped ownership, typed denials, and no automatic garbage collection of
published generations.

### D1. Durable mode per package

The mode of a package is durable state, not an inference. A per-installation
registry maps each `canonicalPackageKey` to `legacy` or `versioned`, with a
monotonic sequence, a mode epoch, the descriptor, the last generation and
pointer sequence, and a lifecycle state. Builtins have explicit entries and no
exceptions.

An absent, unreadable, malformed, unsupported, or entry-less registry fails
closed; absence never authorizes legacy. Legacy compatibility exists only where
the registry declares it. Transition `legacy -> versioned` is controlled and
single-writer. `versioned -> legacy` is forbidden in read and write, and deleting
an entry leaves the key unknown rather than legacy.

### D2. Server authority, no invented local authentication

The daemon is the authority. Client headers, body, query, `localCatalogScopes`,
loopback, and the operating-system user are context attribution only; they do
not authenticate a member. Cloud authority comes from fresh request
verification. Local authority requires a verifiable local trust mechanism that
does not yet exist; until it does, restricted resources are blocked rather than
degraded to loopback or OS identity.

### D3. Canonical identity and activation

Identity is an inseparable pair:

1. `canonicalPackageKey` - an opaque key, unique within an installation scope,
   assigned by an explicit provisioning operation, never reused, and never
   derived from path, name, content, workspace, project, database row, or date.
   No component may parse or reconstruct it.
2. A stable descriptor carrying class/origin, owner namespace, and stable
   package id. Changing any descriptor attribute requires a new key and an
   explicit migration.

The activation key of a generation is `(installationScope, canonicalPackageKey)`.
Workspace, project, principal, binding, alias, and path are not activation
dimensions; authorization is evaluated separately. Public ids remain
compatible aliases, resolved by the server under authorized context: one
legitimate candidate resolves; zero candidates or more than one fail closed; and
search-order precedence is not a resolution rule. Two keys are never merged
during a read; composition happens at publication.

### D4. Run ownership and durable markers

The Run owns its snapshot. The canonical key is fixed at open; after that no
component resolves the public alias to decide what to serve. The Run persists
markers only (mode, key, descriptor digest, generation, manifest digest, pointer
sequence, registry sequence, mode epoch, binding revision, authority epoch,
state, denial code), never document bodies, CSS, HTML, assets, previews, host
paths, secrets, or provider session identifiers.

Recovery revalidates the marker or fails closed; the alias is never re-resolved.
Loss of the owner is terminal: a Run whose process ends does not silently
reopen, resume from the mutable package, or assume recovery. A new attempt is a
new Run with new authorization and a new open.

### Preserved invariants

- **Verified bytes:** SHA-256 is computed over the same buffer that is retained
  and served; consumers never reopen a path.
- **Closed inventory:** the manifest declares every file with path, hash, byte
  size, and kind; extras, missing files, duplicates, traversal, symlinks,
  hardlinks, devices, FIFOs, and unexpected directories fail closed.
- **No cross-key merge:** no read combines fields or files from two keys.
- **Typed denial:** every read throws a typed `SnapshotDeniedError`; `null` or
  text never signals denial and never selects a fallback.
- **Ownership:** one snapshot per Run; retry and tools reuse it; export owns its
  own.
- **No automatic GC:** no process deletes a published generation.
- **Provenance is not approval:** a hash proves bytes, not authorship, approval,
  or date.

## Workstreams

| Workstream | Surface | State at this ADR | Relationship to this ADR |
| --- | --- | --- | --- |
| B2-3 documents | DesignOps masters and derived installed copy | Partial: master reconciliation and checkers delivered; real-package provenance, documentary baseline, and copy into the package remain open; installation frozen | Not closed, not synchronized, not re-owned |
| Snapshot runtime | Daemon read, publication, alias, authority, Run ownership | Not implemented; direction only | This ADR; implementation requires small PRs and gates |
| B2-7 CI and distribution | Package copy/regeneration into `dist/`, release artifacts, mandatory CI, unified verifier criteria | Not started | Out of scope; no claim here; must not rely on an unaccepted identity contract |

## Small PR sequence

PRs are small, sequential, and each one declares which claims it covers and
which it does not. A PR may not widen the claims of this ADR. No PR may
reintroduce workspace or project into the activation key, resolve an ambiguous
alias by precedence, merge keys during a read, add automatic GC, or write to the
installation before explicit owner authorization.

`Depends on` lists only prior PRs. Open questions and gates are listed
separately because an open question blocks the decision and a gate controls
enablement, not merge order.

| PR | Content | Depends on | Blocked by | Gates |
| --- | --- | --- | --- | --- |
| PR-0 | This ADR and its evidence index | None | None | None |
| PR-1 | Registry read, validation, typed errors, fail-closed behavior; activation flag off; no read routed | PR-0 | O1, O2, O3, O7 | G6 before any entry is created |
| PR-2 | Closed inventory, verified in-memory bytes, snapshot API behind the flag | PR-1 | None | G7 before enablement |
| PR-3 | Publisher for one package and explicit migration of one package; no installation write | PR-2 | O1, O5 | G6, G7 |
| PR-4 | Alias resolution, Run markers and ownership, prompt and tool wiring | PR-2 | O4, O6 | G2, G8 |
| PR-5 | OD Next integration, real timeout and cancellation, restart behavior | PR-4 | None | G5 |
| PR-6 | Operational metrics, manual retention procedure, quiescence tooling | PR-2 | O8 | None |
| PR-7 | Windows/macOS Node 24 and multi-process matrix | PR-4 | None | G1, G3, G4 |

## Implementation gates

Gates describe when a part may be implemented or enabled. They do not decide
what the contract is, and with O1-O8 open they do not unblock acceptance.

| Gate | Content | Effect while unmet |
| --- | --- | --- |
| G1 | Windows/macOS on Node 24: rename over open files, locks, antivirus | Versioned path stays Linux-only |
| G2 | Verifiable local authority mechanism | Restricted local resources remain blocked |
| G3 | Real durability: power loss, kernel crash, verified `fsync`, registry consistency | No durability claim |
| G4 | Multi-process exclusion: lock, lease, or fencing | Two processes on one scope must be rejected or declared unsupported |
| G5 | Real OD Next integration with the snapshot | OD Next fails closed under snapshot |
| G6 | Provisioning and migration mechanism and owner: key assignment, descriptor, alias binding, registry entry, durable installation scope | No package is served through the versioned path; the registry is never created on read |
| G7 | Limit calibration and benchmark with real packages | Limits remain exploratory |
| G8 | Disambiguation UX: distinct keys in the catalog, explicit selection, legacy alias mapping | An alias with two legitimate candidates fails closed |

## Open questions blocking acceptance

These are recorded, not decided. Acceptance is withheld until each has an owner
decision and the text is reconciled.

### O1. Activation flag versus D1's no-downgrade rule

The rollout uses an off-by-default activation flag, and the operational rollback
says that turning the flag off returns to the legacy path with explicit risk
acceptance. D1 says that `versioned -> legacy` is invalid in read and write, that
deleting a registry entry leaves the key unknown, and that rollback moves the
pointer inside `versioned`. Both cannot hold for the same migrated package.

Decision required: whether the flag is only a deployment control that leaves
durable mode untouched (and therefore cannot serve legacy after migration), or
whether a supported downgrade exists. The latter is not a silent
reinterpretation: it requires an explicit amendment to D1. Until decided, the
ADR cannot claim D1 is consistently applied.

### O2. Bootstrap authority and first-run behavior

Reads fail closed when the registry is absent, and D1 also fails closed per key
when the registry exists but has no entry. Those are two different states, and
the bootstrap question is separate from the read question:

- **Creating the registry.** Only an authorized provisioning operation (G6) may
  create it, but its authority, first-run sequence, and local verification (G2)
  are undefined on a fresh installation. The actor allowed to create the first
  registry cannot be named, which is circular.
- **Reading with no registry.** Every package, including builtins, is denied.
  This is stated by D1 and is not in dispute.
- **Reading an empty registry.** Whether an empty registry may be created as a
  valid bootstrap state, and what a first run serves before any entry exists,
  is undecided.

Decision required: the bootstrap sequence and authority, whether an empty
registry is a valid state, and the first-run contract. Read behavior for absent
or entry-less registries remains fail-closed regardless.

### O3. Installation-scope move, restore, and clone

The activation key includes `installationScope`, which must be durable and must
not change merely because the data root moves. No scope identity mechanism
exists, and this ADR forbids inventing a data path. Move, backup and restore,
clone, and two daemons sharing a data root therefore have no defined outcome,
while Run markers must match the current scope.

Decision required: what anchors the scope, what happens on copy or restore, and
whether clones are rejected or assigned a new scope.

### O4. Mirror owner namespace

Two readings are in dispute, and the record does not establish which one the
owner endorsed:

- **Reading A:** a shared key requires an identical descriptor, and the
  descriptor includes the owner namespace. A personal copy is owned by a
  personal space and a team mirror by a team space, so they cannot share a key
  even with lineage.
- **Reading B:** lineage and shared publication can put both materializations
  under one key, which requires the mirror's descriptor to carry the owner
  namespace of the publishing owner rather than the space where the mirror is
  stored.

Decision required: which reading is authoritative, whose namespace a mirror's
descriptor carries, and whether a shared key implies a single owner.

### O5. One generation store versus per-materialization copies

Two readings are in dispute, and the record does not establish which one the
owner endorsed:

- **Reading A:** one generation per key and one authoritative store;
  materializations are views or references, and a second physical copy would be
  a second store.
- **Reading B:** each materialization root holds its own copy of the generation,
  and byte identity is a verified property of those copies rather than a single
  store.

It is undefined which copy is authoritative at read time and how byte identity
is proven without consumers reopening paths.

Decision required: which reading is authoritative, the storage topology for
shared keys, and the authority of each copy.

### O6. Alias precedence and candidate legitimacy

The alias rules say precedence never resolves ambiguity, but compatibility says
the alias keeps resolving where today's precedence yields a single legitimate
candidate, and the current catalog drops the personal entry when a team entry
exists. "Legitimate candidate" and the promised unchanged result therefore
depend on the precedence the rule forbids, and the catalog can hide a candidate
that would otherwise make the alias ambiguous.

Decision required: the candidate-set definition, the catalog contract, and
whether any existing flow changes.

### O7. Descriptor digest canonicalization

D4 records a descriptor digest, and the registry stores the descriptor or its
digest, but no canonical encoding, field set, version, or upgrade rule is
defined. Two implementations, or one implementation across a descriptor-shaped
migration, can produce different digests for the same descriptor, making
mismatch undecidable.

Decision required: the canonical serialization, its versioning, and exactly what
the digest covers.

### O8. Cleanup versus the no-GC claim

Two readings are in dispute, and the record does not establish which one the
owner endorsed:

- **Reading A:** no automatic deletion of anything that could be referenced;
  temporary and incomplete output may be cleaned or quarantined automatically,
  and published generations are never deleted automatically.
- **Reading B:** no automatic deletion at all, including temporary and
  incomplete output, until an operator procedure with verified quiescence
  exists.

"Published", "temporary", and "incomplete" have no operational boundary, and a
crash orphan is complete but unreferenced.

Decision required: which reading is authoritative, the classification, who may
delete what, and whether any deletion is automatic. Until then the no-GC claim
is not precise enough to accept.

## Alternatives considered

- **Status quo:** zero change, but keeps mixed generations, unverified bytes,
  alias collisions, and implicit composition. Rejected.
- **Derived key** from path, name, or content: changes with the installation and
  with every publication, and collides for the same name in two roots. Rejected.
- **Public alias as key:** the alias is what collides today and can be
  reassigned. Rejected.
- **Key including workspace or project:** makes consumption location part of
  identity and contradicts D3. Rejected.
- **Opaque assigned key (recorded direction):** identifies a tree independently
  of path, content, alias, and workspace, at the cost of explicit provisioning
  and migration.

## Consequences

If accepted, one operation sees one generation; served bytes are the verified
bytes; a builtin and a user package with the same name stop being confused; the
mode becomes explicit and durable; authority stays in the server; rebind,
revocation, and retirement become terminal and visible; and rollback remains
possible without an automatic GC race.

The costs are a new provisioned concept and alias-to-key relation, migration
before the versioned path is usable, possible explicit selection where an alias
is ambiguous, memory and load latency per snapshot, loss of snapshots across
restart, a durable registry whose corruption blocks the scope, disk growth
without automatic GC, and OD Next failing closed until integrated.

Acceptance is currently blocked. The status quo defects and the B2-3 open items
remain in force.

## Evidence

### Durable evidence

Repository-traceable artifacts, verified on 2026-11-20. The internal
repositories require organization access; names and links are intentionally
omitted from this public repository.

- Internal DesignOps PR #7, merged commit
  `0aea21dcb4c68b54c20ec86660b64e73c6e74c59` (B2-3 documentary master and
  derived-copy direction).
- Internal Core PR #1115, merged commit
  `9ed431856b0a6b45742b8c85e61fdc7ac4165f17` (preserve declared manifest fields
  on sync). Earlier preview-loss findings belong to a previous adapter and must
  not be attributed to current Core main.

### Ephemeral evidence

Local proof-of-concept and probe artifacts. The logs are not durable, are not
reproducible from this repository, and are not CI results. Only summarized data
is recorded here.

- **Document state:** pre-incident, all five baseline-generated artifacts
  matched the installed package. After the incident, four of five still match;
  `design-tokens.json` does not. Three generated JSON artifacts were rewritten
  (`design-tokens.json`, `source/scanned-files.json`,
  `source/token-contract.report.json`). `manifest.json` and
  `source/evidence.md` were restored byte-exact. `DESIGN.md` and `USAGE.md` did
  not change in the incident but remain pre-B2-3 drift. The installation stays
  frozen, unapproved, and is not claimed to be intact.
- **Snapshot prototype:** one preserved run reported 29/29 passing; another
  reported 28/29 with one permission-test failure whose environmental
  explanation is plausible but unproven. An independent reproduction of the
  reader-consistency suites reported 15 passing plus 1 expected failure.
  Per-file resolution mixed generations in 13-38% of snapshots; pinned
  resolution mixed none. `retention=1` failed 72 of 500 snapshots and left 528
  files absent. Two writers produced 7 pointer regressions in 50 swaps.
  Truncated reads: 7/2000 in place, 14/2000 in-place split, 0/2000 with
  temp-and-rename.
- **Platforms:** the recorded Windows probe ran on Node v22.16.0, win32 x64, and
  observed `EPERM` on replacing an open file and `EBUSY` on unlink; the exact
  mechanism was not isolated. Node 24 on Windows was not run. macOS was not
  tested. Linux evidence is Node 24.21.0, ext4, WSL2.
- **Material:** this summary contains no user material and no customer data.

## Non-claims

This ADR does not claim that package identity, a mode registry, or a durable
`installationScope` exists today; that the canonical key is supported by the
runtime; durability across power loss or kernel crash; registry consistency
across a crash; multi-process exclusion, leases, or fencing; Windows or macOS
support; OD Next, real timeout, or real cancellation coverage; coverage of the
real package by fixtures; that a hash is an approval; that the installed package
has demonstrated provenance; that the current baseline covers documents,
manifest, or previews; or that verifiable local authority exists.

## References

- Root [`AGENTS.md`](../../AGENTS.md) → **Daemon data directory contract**
- [`docs/adr/0001-centralize-daemon-startup.md`](0001-centralize-daemon-startup.md)
