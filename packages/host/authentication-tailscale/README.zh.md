---
kind: package-reference
description: "无需启动令牌，让 Tailscale Serve 识别出的 Tailnet 用户直接登录。"
---

# @deepseek-ai/dsh-host-authentication-tailscale

[English](README.md) | 中文

## 概述

通过 `tailscale serve` 打开 Host 的 Tailnet 用户无需启动令牌即可登录。Tailscale Serve 会把 `Tailscale-User-Login` 请求头设为发送者的登录名；本 Provider 在该请求头只有一个值且属于 `allowedLogins` 时，以 owner 身份准入请求。没有允许登录名的请求交给下一个 Provider，例如 [Token 认证](../authentication-token/README.zh.md)。

## 目录

- [使用](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用

在监听器只绑定 loopback、并通过 `tailscale serve` 发布到 Tailnet 的 Host 上，把这个函数插件挂在 Connection 旁边。它注入 `connection` 创建 Peer，注入 `connection.authentication` 注册 Provider。[Server 运行配置](../../bundle/server-app/README.zh.md)会用本机所属 Tailnet 用户的登录名挂载它。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `allowedLogins` | 必填 | 以 owner 权限准入的 Tailscale 登录名，例如 `alice@github`；至少一个，不含空白 |

空列表在加载时失败。请求头缺失、为空、重复或不在列表中时，请求交给下一个 Provider。所有被准入的请求在插件生命周期内共享一个 owner Peer；卸载插件会移除注册并结束该 Peer。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[插件入口](src/index.ts)导出 `name`、`inject`、`Config` 和 `apply`。它从 Fetch 或 node:http 两种表示中读取请求头，拒绝以逗号拼接的重复值，并精确比较登录名。Provider 不发起网络调用，也不保存按用户区分的状态。Token、Desktop 和 Tailscale Provider 通过同一个 ConnectionAuthentication 服务注册，彼此互不依赖。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Server 运行配置](../../bundle/server-app/README.zh.md)——owner 登录名与 Tailnet 名称的检测。
- [Connection](../../client/connection/README.zh.md)——ConnectionAuthentication 注册与 Peer 生命周期。
- [Token 认证](../authentication-token/README.zh.md)——同一 Host 上的启动令牌登录。

<a id="model-experience"></a>
## 模型体验

无，因为认证不增加模型可见输入。

#### KV Cache 影响

无；认证不修改模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只有在 `tailscale serve` 之后请求头才可信**——任何能直接访问监听器的进程都可以设置 `Tailscale-User-Login`。请让监听器保持在 loopback，并在沙箱中运行不受信任的本地代码。
- **每个允许的登录名都是 owner**——Provider 不区分用户角色；非 owner Peer 需要 [Remote access](../../api/remote-access/README.zh.md) 策略以及能创建它们的 Provider。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
