# @bbardia/cd3

A local-first C4 architecture editor with synchronized 2D and 3D views — one command, no install:

```sh
npx @bbardia/cd3
```

Opens `http://127.0.0.1:6985` in your browser. Projects save to `~/.cd3` (override with
`CD3_DATA_DIR`); `PORT` changes the port. No cloud, no accounts, no telemetry.

To host an instance for a team, publish the address people will type:

```sh
CD3_PUBLIC_ORIGIN=http://cd3.lan:6985 npx @bbardia/cd3
```

Everyone who can reach a published instance shares one project and may edit it — keep it on a
trusted network or behind an authenticating proxy.

Docs, desktop builds, and source: [github.com/Bbardia/CD3](https://github.com/Bbardia/CD3).
