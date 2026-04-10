# opencodex-fast

An OpenCode plugin that adds `"service_tier": "priority"` to matching requests when `/fast` is enabled.

## What It Does

- Adds a `/fast` command to OpenCode
- By default, injects `service_tier: "priority"` into requests whose URL contains `/backend-api/codex/responses`
- Supports additional third-party URLs through plugin options in `opencode.json`
- Leaves all other requests untouched
- Supports configuring startup `enabled` state in plugin options
- Keeps backward compatibility with `~/.config/opencode/opencodex-fast.jsonc`

## Commands

```text
/fast           Toggle fast mode
/fast on        Enable fast mode
/fast off       Disable fast mode
/fast status    Show current fast-mode state
```

## Installation

Add the plugin to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencodex-fast@latest"]
}
```

## Configuration

You can pass plugin options directly from `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencodex-fast@latest",
      {
        "enabled": true,
        "extraUrls": [
          "https://third-party.example.com/v1/responses",
          "https://proxy.example.com/backend-api/codex/responses"
        ]
      }
    ]
  ]
}
```

### Options

- `enabled`: startup fast-mode state
- `extraUrls`: additional request URLs to match for priority injection

### Behavior Notes

- The built-in Codex matcher `/backend-api/codex/responses` is always kept; `extraUrls` only adds more matches
- If plugin config sets `enabled`, that value takes precedence on startup
- If plugin config does not set `enabled`, the plugin falls back to `~/.config/opencode/opencodex-fast.jsonc`
- `/fast` still updates the current session and writes the state file for backward compatibility
- When plugin config sets `enabled`, restarting OpenCode restores the configured value even if `/fast` changed it during the previous session
