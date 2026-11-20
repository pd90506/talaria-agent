---
description: "常驻 Host 与 Web UI，Tailnet 内的设备通过 Tailscale Serve 访问，适合在家用服务器上运行 dsh。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-server-app`

[English](README.md) | 中文

## 概述

`dsh server` 把完整的 Web 应用作为 Tailnet 内的常驻 Host 运行。该 bundle 叠加在 [`dsh-base`](../base/README.zh.md) 与 [`dsh-web-app`](../web-app/README.zh.md) 之上：监听器保持在 loopback，`tailscale serve` 通过 HTTPS 发布它，本机所属的 Tailnet 用户通过 [Tailscale 认证](../../host/authentication-tailscale/README.zh.md)直接登录，无需启动令牌。启动时从本地 Tailscale CLI 读取本机 MagicDNS 名称与 `tailscale serve` 根地址，信任该名称、通告该根地址，并且从不打开浏览器。

## 目录

- [使用](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用

先发布一次监听端口，再启动该运行配置：

```sh
tailscale serve --bg 3080
dsh server
```

在任何以本机 owner 身份登录 Tailscale 的设备上打开输出的 `dsh web:` 根地址，例如 `https://box.tail1234.ts.net/`。`dsh server` 接受 Web 参数；`--port` 同时改变监听端口以及启动检查期望 `tailscale serve` 指向的端口，`--public-url` 替换检测到的根地址。如果没有 `tailscale serve` 处理器代理到该监听器，启动时会给出警告和需要执行的命令。启动令牌 URL 仍可用于本机访问。

Tailscale CLI 缺失、节点未运行或 MagicDNS 关闭时，启动失败。打了 tag 的机器没有 owner 登录名，`allowedLogins` 为空，认证会在加载时失败；请在 `$DSH_HOME/profiles/server/cordis.patch.yml` 中覆盖 `authentication-tailscale` 行：

```yaml
- id: authentication-tailscale
  config:
    allowedLogins: [alice@github]
```

| `server-tailscale-node` 字段 | 默认值 | 含义 |
|---|---|---|
| `command` | `tailscale` | Tailscale CLI 可执行文件名或路径 |
| `timeoutMs` | `5000` | 每次 CLI 查询的期限 |
| `listenPort` | `--port`，否则 `3080` | `tailscale serve` 应代理到的 loopback 端口 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[插件入口](src/index.ts)在加载时各运行一次 `tailscale status --json` 与 `tailscale serve status --json`，并提供 `tailscaleNode` 服务：`dnsName`、`ownerLogins` 以及可选的 `serveUrl`。[`tailscale-status.ts`](src/tailscale-status.ts) 包含纯读取函数。[patch](cordis.patch.yml) 插入这一行和认证行，把 `dnsName` 加入 Connection 的 `trustedHosts`（任意端口），将 Web runtime 的 `publicUrl` 依次取 `--public-url`、`serveUrl`、`https://<dnsName>/`，设置 `openBrowser: false`，并禁用 HMR。读取 `tailscaleNode` 的行都会注入它，因此会等待查询完成。

</details>

<a id="model-experience"></a>
## 模型体验

### 通告的 Tailnet URL

#### 模型看到的内容

Web 运行时上下文给出通告的根地址，例如 `https://box.tail1234.ts.net/`，而不是 loopback 地址。启动令牌不会进入模型。

#### Token 影响

与 Web 运行配置相同的一行 URL。

#### KV Cache 影响

MagicDNS 名称与 `tailscale serve` 根地址不变时保持稳定；变化在下次启动时生效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **Tailscale 状态只读取一次**——之后修改 `tailscale serve`、重命名 MagicDNS 或节点登出，都需要重启。
- **Host 必须保持运行**——该运行配置不安装系统服务；定时任务只在 `dsh server` 运行期间执行。
- **本地进程被信任**——任何能访问 loopback 监听器的进程都可以设置 Tailscale 身份请求头，详见[认证限制](../../host/authentication-tailscale/README.zh.md#known-limitations-and-deferred-work)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
