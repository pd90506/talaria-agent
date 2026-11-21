---
kind: upgrade-guide
description: "The default Harness home moves from ~/.dsh to ~/.talaria-agent, so existing data is not found until it is moved or DSH_HOME points at it."
---

# Default Harness home moves to ~/.talaria-agent

English | [中文](guide.zh.md)

## Change

Talaria Agent no longer shares its default data directory with DeepSeek Harness. Without `DSH_HOME`, the CLI, `dsh server`, and the Talaria Agent desktop application read and write `~/.talaria-agent` instead of `~/.dsh`; `DEFAULT_DSH_HOME_DISPLAY` from `@deepseek-ai/dsh-home-paths` reads `~/.talaria-agent`. Sessions, profiles, credentials, settings, and attachments under `~/.dsh` are not read. Installations that set `DSH_HOME` are unaffected.

## Migration

1. Quit every running Talaria Agent process, including the desktop application and `dsh server`.
2. To keep existing data, copy it: `cp -R ~/.dsh ~/.talaria-agent`. Skip this step to start with an empty home.
3. To keep using `~/.dsh` instead, export `DSH_HOME=~/.dsh` for the CLI and the server.
4. Start Talaria Agent and confirm that earlier sessions appear in the session list.
