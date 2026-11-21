---
kind: package-reference
description: "Sign in Tailnet users that Tailscale Serve identifies, without a launch token."
---

# @deepseek-ai/dsh-host-authentication-tailscale

English | [中文](README.zh.md)

## Summary

A Tailnet user who opens the Host through `tailscale serve` signs in without a launch token. Tailscale Serve sets the `Tailscale-User-Login` header to the sender's login name; this provider admits a request whose single header value is in `allowedLogins` as the owner. Requests without an allowed login fall through to the next provider, such as [Token authentication](../authentication-token/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this function plugin beside Connection on a Host whose listener stays on loopback and is published to the Tailnet with `tailscale serve`. It injects `connection` for Peer creation and `connection.authentication` for Provider registration. The [server profile](../../bundle/server-app/README.md) mounts it with the login of the Tailnet user who owns the machine.

| Field | Default | Meaning |
|---|---|---|
| `allowedLogins` | required | Tailscale login names, such as `alice@github`, admitted with owner access; at least one, without whitespace |

An empty list fails at load. A missing, empty, repeated, or unlisted header leaves the request to the next provider. All admitted requests share one owner Peer for the plugin lifetime; disposing the plugin removes the registration and ends that Peer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [plugin entry](src/index.ts) exports `name`, `inject`, `Config`, and `apply`. It reads the header from either the Fetch or node:http representation, rejects a comma-joined repeated value, and compares the exact login. The provider performs no network call and keeps no per-user state. Token, Desktop, and Tailscale providers register through the same ConnectionAuthentication service and do not depend on each other.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Server profile](../../bundle/server-app/README.md) — detection of the owner login and the Tailnet name.
- [Connection](../../client/connection/README.md) — ConnectionAuthentication registration and Peer lifecycle.
- [Token authentication](../authentication-token/README.md) — launch-token sign-in on the same Host.

<a id="model-experience"></a>
## Model Experience

None, as authentication introduces no model-visible input.

#### KV Cache effect

None; authentication does not modify model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The header is trusted only behind `tailscale serve`** — any process that reaches the listener directly can set `Tailscale-User-Login`. Keep the listener on loopback and run untrusted local code in the sandbox.
- **Every allowed login is the owner** — the provider has no per-user roles; non-owner Peers need a [Remote access](../../api/remote-access/README.md) policy and a provider that creates them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
