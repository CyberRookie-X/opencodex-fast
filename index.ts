import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

const DEFAULT_CODEX_URL_MATCHER = "/backend-api/codex/responses";
const FAST_ON_MESSAGE = "Fast mode is now ON.";
const FAST_OFF_MESSAGE = "Fast mode is now OFF.";
const FAST_HANDLED_ERROR = "__FAST_HANDLED__";
const STATE_PATH = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "opencode",
    "opencodex-fast.jsonc",
);

type FastPluginOptions = {
    enabled?: unknown;
    extraUrls?: unknown;
};

let fastEnabled = false;
let configuredEnabled: boolean | undefined;
let urlMatchers = [DEFAULT_CODEX_URL_MATCHER];

function ensureStateDir(): void {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
}

function resolveUrl(input: any): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url ?? "";
}

function normalizeMatcherList(input: unknown): string[] {
    if (!Array.isArray(input)) return [];

    return input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
}

function trimTrailingSlashes(value: string): string {
    return value.replace(/\/+$/, "");
}

function matchesUrl(url: string, matcher: string): boolean {
    if (matcher.includes("://")) {
        const normalizedUrl = trimTrailingSlashes(url);
        const normalizedMatcher = trimTrailingSlashes(matcher);
        return (
            normalizedUrl === normalizedMatcher ||
            normalizedUrl.startsWith(`${normalizedMatcher}?`) ||
            normalizedUrl.startsWith(`${normalizedMatcher}#`) ||
            normalizedUrl.startsWith(`${normalizedMatcher}/`)
        );
    }

    return url.includes(matcher);
}

function matchesConfiguredUrl(url: string): boolean {
    return urlMatchers.some((matcher) => matchesUrl(url, matcher));
}

function parseBody(body: unknown): Record<string, unknown> | null {
    if (typeof body !== "string") return null;

    try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function writeState(enabled: boolean): void {
    ensureStateDir();
    const tempPath = `${STATE_PATH}.tmp`;
    const content = `${JSON.stringify({ enabled }, null, 2)}\n`;
    writeFileSync(tempPath, content, "utf8");
    renameSync(tempPath, STATE_PATH);
}

function readState(): boolean {
    try {
        if (!existsSync(STATE_PATH)) {
            writeState(false);
            return false;
        }

        const raw = readFileSync(STATE_PATH, "utf8");
        const parsed = JSON.parse(raw) as { enabled?: unknown };
        return parsed.enabled === true;
    } catch {
        return false;
    }
}

function resolveConfiguredEnabled(options: FastPluginOptions | undefined):
    | boolean
    | undefined {
    return typeof options?.enabled === "boolean" ? options.enabled : undefined;
}

function resolveInitialEnabled(options: FastPluginOptions | undefined): boolean {
    const enabled = resolveConfiguredEnabled(options);
    if (enabled !== undefined) return enabled;
    return readState();
}

function resolveUrlMatchers(options: FastPluginOptions | undefined): string[] {
    return Array.from(
        new Set([
            DEFAULT_CODEX_URL_MATCHER,
            ...normalizeMatcherList(options?.extraUrls),
        ]),
    );
}

function appendConfigNote(message: string): string {
    if (configuredEnabled === undefined) return message;
    if (fastEnabled === configuredEnabled) return message;
    return `${message} Restart will restore the plugin-configured ${configuredEnabled ? "ON" : "OFF"} state.`;
}

function maybeInjectPriority(init: any, input: any): any {
    const url = resolveUrl(input);
    if (!matchesConfiguredUrl(url)) return init;
    if (!fastEnabled) return init;

    const body = parseBody(init?.body);
    if (!body) return init;
    if (body.service_tier === "priority") return init;

    return {
        ...init,
        body: JSON.stringify({
            ...body,
            service_tier: "priority",
        }),
    };
}

async function sendIgnoredMessage(
    client: any,
    sessionID: string,
    text: string,
): Promise<void> {
    await client.session.prompt({
        path: { id: sessionID },
        body: {
            noReply: true,
            parts: [
                {
                    type: "text",
                    text,
                    ignored: true,
                },
            ],
        },
    });
}

function getFastMessage(modeArg?: string): string {
    const normalized = modeArg?.toLowerCase();

    if (normalized === "on") {
        fastEnabled = true;
        writeState(true);
        return appendConfigNote(FAST_ON_MESSAGE);
    }

    if (normalized === "off") {
        fastEnabled = false;
        writeState(false);
        return appendConfigNote(FAST_OFF_MESSAGE);
    }

    if (normalized === "status") {
        return appendConfigNote(fastEnabled ? FAST_ON_MESSAGE : FAST_OFF_MESSAGE);
    }

    if (fastEnabled) {
        fastEnabled = false;
        writeState(false);
        return appendConfigNote(FAST_OFF_MESSAGE);
    }

    fastEnabled = true;
    writeState(true);
    return appendConfigNote(FAST_ON_MESSAGE);
}

const plugin: Plugin = async (ctx, options) => {
    const fastOptions = options as FastPluginOptions | undefined;
    configuredEnabled = resolveConfiguredEnabled(fastOptions);
    fastEnabled = resolveInitialEnabled(fastOptions);
    urlMatchers = resolveUrlMatchers(fastOptions);
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: any, init?: any) => {
        const nextInit = maybeInjectPriority(init, input);
        return originalFetch(input, nextInit);
    };

    return {
        config: async (opencodeConfig) => {
            opencodeConfig.command ??= {};
            opencodeConfig.command["fast"] = {
                template: "[on|off|status]",
                description: "Toggle priority service tier injection",
            };
        },

        "command.execute.before": async (
            input: { command: string; sessionID: string; arguments: string },
            _output: { parts: any[] },
        ) => {
            if (input.command !== "fast") {
                return;
            }

            const message = getFastMessage(input.arguments.trim() || undefined);
            await sendIgnoredMessage(ctx.client, input.sessionID, message);
            throw new Error(FAST_HANDLED_ERROR);
        },
    };
};

export default plugin;
