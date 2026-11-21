---
description: "Always-on Host with the Web UI that Tailnet devices reach through Tailscale Serve, for users running dsh on a home server."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-server-app`

English | [中文](README.zh.md)

## Summary

`dsh server` runs the complete Web application as an always-on Host for your Tailnet. The bundle layers over [`dsh-base`](../base/README.md) and [`dsh-web-app`](../web-app/README.md): the listener stays on loopback, `tailscale serve` publishes it over HTTPS, and the Tailnet user who owns the machine signs in through [Tailscale authentication](../../host/authentication-tailscale/README.md) without a launch token. Startup reads the machine's MagicDNS name and the `tailscale serve` root from the local Tailscale CLI, trusts that name, advertises that root, and never opens a browser.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Publish the listener port once, then start the profile:

```sh
tailscale serve --bg 3080
dsh server
```

Open the printed `dsh web:` root, such as `https://box.tail1234.ts.net/`, from any device signed in as the machine's owner. `dsh server` accepts the Web flags; `--port` changes both the listener and the port the startup check expects `tailscale serve` to target, and `--public-url` replaces the detected root. When no `tailscale serve` handler proxies to the listener, startup warns with the command to run. The launch-token URL still works for local access.

Startup fails when the Tailscale CLI is missing, the node is not running, or MagicDNS is off. A tagged machine has no owner login, so `allowedLogins` is empty and authentication fails at load; override the `authentication-tailscale` row in `$DSH_HOME/profiles/server/cordis.patch.yml`:

```yaml
- id: authentication-tailscale
  config:
    allowedLogins: [alice@github]
```

| `server-tailscale-node` field | Default | Meaning |
|---|---|---|
| `command` | `tailscale` | Tailscale CLI executable name or path |
| `timeoutMs` | `5000` | Deadline for each CLI query |
| `listenPort` | `--port`, else `3080` | Loopback port that `tailscale serve` should proxy to |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [plugin entry](src/index.ts) runs `tailscale status --json` and `tailscale serve status --json` once at load and provides the `tailscaleNode` service: `dnsName`, `ownerLogins`, and the optional `serveUrl`. [`tailscale-status.ts`](src/tailscale-status.ts) holds the pure readers. The [patch](cordis.patch.yml) inserts this row and the authentication row, adds `dnsName` to the Connection `trustedHosts` on any port, sets the Web runtime `publicUrl` to `--public-url`, then `serveUrl`, then `https://<dnsName>/`, sets `openBrowser: false`, and disables HMR. Rows that read `tailscaleNode` inject it, so they wait for the query.

</details>

<a id="model-experience"></a>
## Model Experience

### Advertised Tailnet URL

#### What the model sees

The Web runtime context names the advertised root, such as `https://box.tail1234.ts.net/`, instead of the loopback origin. No launch token reaches the model.

#### Token effect

The same single URL line as the Web profile.

#### KV Cache effect

Stable while the MagicDNS name and the `tailscale serve` root stay unchanged; a change takes effect on the next start.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Tailscale state is read once** — a later `tailscale serve` change, a MagicDNS rename, or a node logout needs a restart.
- **The Host must stay running** — the profile installs no system service; scheduled tasks run only while `dsh server` is running.
- **Local processes are trusted** — any process that reaches the loopback listener can set the Tailscale identity header, as the [authentication limits](../../host/authentication-tailscale/README.md#known-limitations-and-deferred-work) describe.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
