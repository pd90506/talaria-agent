---
kind: upgrade-guide
description: "默认 Harness home 从 ~/.dsh 改为 ~/.talaria-agent；在迁移数据或用 DSH_HOME 指向旧目录之前，原有数据不会被读取。"
---

# 默认 Harness home 改为 ~/.talaria-agent

[English](guide.md) | 中文

## 变更

Talaria Agent 不再与 DeepSeek Harness 共用默认数据目录。未设置 `DSH_HOME` 时，CLI、`dsh server` 和 Talaria Agent 桌面应用读写 `~/.talaria-agent`，而不是 `~/.dsh`；`@deepseek-ai/dsh-home-paths` 的 `DEFAULT_DSH_HOME_DISPLAY` 为 `~/.talaria-agent`。`~/.dsh` 下的会话、profile、凭据、设置和附件不会被读取。设置了 `DSH_HOME` 的安装不受影响。

## 迁移

1. 退出所有正在运行的 Talaria Agent 进程，包括桌面应用和 `dsh server`。
2. 如需保留已有数据，复制目录：`cp -R ~/.dsh ~/.talaria-agent`。如果想从空目录开始，跳过此步。
3. 如需继续使用 `~/.dsh`，为 CLI 和 server 导出 `DSH_HOME=~/.dsh`。
4. 启动 Talaria Agent，确认会话列表中出现之前的会话。
