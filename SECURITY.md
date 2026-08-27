# Security

## Reporting a vulnerability

Report vulnerabilities privately via
[GitHub security advisories](https://github.com/Bbardia/CD3/security/advisories/new). Please do not
open a public issue for anything exploitable. You should hear back within a week.

Only the latest release is supported; fixes ship as a new release, never as patches to old ones.

## What CD3 does and does not defend

CD3 is local-first: the server binds to loopback and answers only loopback origins until you
explicitly publish an address via `CD3_PUBLIC_ORIGIN`. Published or not, it refuses cross-origin
mutations, so a page on another site cannot drive a running instance.

CD3 has **no accounts and no access control**. Everyone who can reach a published instance shares
one project and may edit or delete it; the revision guard turns simultaneous writes into an honest
conflict, not into authorization. Keep a published instance on a trusted network or behind an
authenticating proxy. An instance reachable by an attacker is not a vulnerability in CD3, it is the
documented trade-off.

Anything that breaks the loopback-only default, the cross-origin refusal, or the desktop shell's
renderer isolation **is** a vulnerability. Please report it.

## Release integrity

Desktop builds are unsigned (no Apple/Windows signing identity), so verify you downloaded from
[github.com/Bbardia/CD3/releases](https://github.com/Bbardia/CD3/releases). The npm package
`@bbardia/cd3` is published with provenance from this repository's release workflow.
