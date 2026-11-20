#!/usr/bin/env node
// Fake Tailscale CLI: prints FAKE_TAILSCALE_STATUS or FAKE_TAILSCALE_SERVE for the two queries the server profile runs.
const serve = process.argv[2] === 'serve'
process.stdout.write(process.env[serve ? 'FAKE_TAILSCALE_SERVE' : 'FAKE_TAILSCALE_STATUS'] ?? '{}')
