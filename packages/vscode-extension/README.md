# Synaptic Sentinel — VSCode Extension

Agentic security auditing for the vibe-coding era, right inside your editor.

Synaptic Sentinel scans your workspace with a swarm of deterministic security
scouts and surfaces the findings as inline diagnostics, a hover with the
exploitability detail, and a "living tome" side panel.

## Features

- **Scan Workspace** — runs the scout swarm (SAST, secrets, vulnerable
  dependencies, IaC misconfigurations, and AI-generated-code anti-patterns)
  and paints the findings as inline diagnostics.
- **Triage Findings (Brain Layer)** — an optional premium layer that uses an
  LLM to classify each finding (true / false positive), explain its
  exploitability chain, and suggest a remediation. Bring Your Own Key.
- **Living tome** — a side panel that lists every finding grouped by
  severity, clickable to jump straight to the code.
- **Code Actions** — mark a finding as a false positive, or copy a suggested
  remediation to the clipboard.

## Requirements

- The **Triage Findings** command requires an Anthropic API key (BYOK). Set
  it with the **Set Anthropic API Key (BYOK)** command; it is stored
  encrypted in the operating system's secret store, never in plain text.

## Commands

- `Synaptic Sentinel: Scan Workspace`
- `Synaptic Sentinel: Triage Findings (Brain Layer)`
- `Synaptic Sentinel: Set Anthropic API Key (BYOK)`

## License

Apache-2.0.
