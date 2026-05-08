import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import { registerPermissionSystemCommand } from "../src/config-modal";
import {
  DEFAULT_EXTENSION_CONFIG,
  normalizePermissionSystemConfig,
  type PermissionSystemExtensionConfig,
} from "../src/extension-config";
import type { Rule } from "../src/rule";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getSettingsListTheme: () => ({}),
}));

vi.mock("@earendil-works/pi-tui", () => ({
  SettingsList: class {
    handleInput(): void {}
    updateValue(): void {}
    render(): string[] {
      return [];
    }
    invalidate(): void {}
  },
}));

type Notification = { message: string; level: "info" | "warning" | "error" };

type CommandContextStub = {
  hasUI: boolean;
  ui: {
    notify(message: string, level: "info" | "warning" | "error"): void;
    custom<T>(
      renderer: (...args: unknown[]) => unknown,
      options?: unknown,
    ): Promise<T>;
  };
};

function createCommandContext(hasUI: boolean): {
  ctx: CommandContextStub;
  notifications: Notification[];
  getCustomCalls(): number;
} {
  const notifications: Notification[] = [];
  let customCalls = 0;

  return {
    ctx: {
      hasUI,
      ui: {
        notify(message: string, level: "info" | "warning" | "error") {
          notifications.push({ message, level });
        },
        async custom<T>(
          _renderer: (...args: unknown[]) => unknown,
          _options?: unknown,
        ): Promise<T> {
          customCalls += 1;
          return undefined as T;
        },
      },
    },
    notifications,
    getCustomCalls: () => customCalls,
  };
}

function lastNotification(notifications: Notification[]): Notification {
  return notifications[notifications.length - 1] as Notification;
}

test("permission-system command completions expose top-level config actions", () => {
  const baseDir = mkdtempSync(
    join(tmpdir(), "pi-permission-system-command-completions-"),
  );
  const configPath = join(baseDir, "config.json");
  let config: PermissionSystemExtensionConfig = { ...DEFAULT_EXTENSION_CONFIG };

  try {
    const controller = {
      getConfig: () => config,
      setConfig: (next: PermissionSystemExtensionConfig) => {
        config = next;
      },
      getConfigPath: () => configPath,
    };

    let definition: {
      description: string;
      getArgumentCompletions?: (
        argumentPrefix: string,
      ) => Array<{ value: string; label: string; description?: string }> | null;
      handler: (args: string, ctx: CommandContextStub) => Promise<void>;
    } | null = null;

    registerPermissionSystemCommand(
      {
        registerCommand(_name: string, nextDefinition: typeof definition) {
          definition = nextDefinition;
        },
      } as never,
      controller as never,
    );

    assert.ok(definition !== null);
    assert.ok(typeof definition?.getArgumentCompletions === "function");

    const topLevel = definition?.getArgumentCompletions?.("");
    assert.ok(Array.isArray(topLevel));
    assert.ok(topLevel?.some((item) => item.value === "show"));
    assert.ok(topLevel?.some((item) => item.value === "reset"));

    const filtered = definition?.getArgumentCompletions?.("pa");
    assert.deepEqual(
      filtered?.map((item) => item.value),
      ["path"],
    );
    assert.equal(definition?.getArgumentCompletions?.("path extra"), null);
    assert.equal(definition?.getArgumentCompletions?.("zzz"), null);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("permission-system command handlers manage config summary, persistence, and modal routing", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-command-"));
  const configPath = join(baseDir, "config.json");
  let config: PermissionSystemExtensionConfig = {
    debugLog: true,
    permissionReviewLog: false,
    yoloMode: true,
  };

  try {
    writeFileSync(
      configPath,
      `${JSON.stringify(normalizePermissionSystemConfig(config), null, 2)}\n`,
      "utf-8",
    );

    const controller = {
      getConfig: () => config,
      setConfig: (next: PermissionSystemExtensionConfig) => {
        const currentConfig = normalizePermissionSystemConfig(
          JSON.parse(readFileSync(configPath, "utf-8")) as unknown,
        );
        const normalized = normalizePermissionSystemConfig(next);
        writeFileSync(
          configPath,
          `${JSON.stringify(normalized, null, 2)}\n`,
          "utf-8",
        );
        config = normalizePermissionSystemConfig(
          JSON.parse(readFileSync(configPath, "utf-8")) as unknown,
        );
        assert.notDeepEqual(config, currentConfig);
      },
      getConfigPath: () => configPath,
    };

    let registeredName = "";
    let definition: {
      description: string;
      getArgumentCompletions?: (
        argumentPrefix: string,
      ) => Array<{ value: string; label: string; description?: string }> | null;
      handler: (args: string, ctx: CommandContextStub) => Promise<void>;
    } | null = null;

    registerPermissionSystemCommand(
      {
        registerCommand(name: string, nextDefinition: typeof definition) {
          registeredName = name;
          definition = nextDefinition;
        },
      } as never,
      controller as never,
    );

    assert.equal(registeredName, "permission-system");
    assert.ok(definition !== null);
    assert.ok(
      (definition?.description ?? "").includes(
        "Configure pi-permission-system",
      ),
    );

    const infoCtx = createCommandContext(true);
    await definition?.handler("show", infoCtx.ctx);
    assert.ok(
      lastNotification(infoCtx.notifications).message.includes("yoloMode=on"),
    );
    assert.ok(
      lastNotification(infoCtx.notifications).message.includes("debugLog=on"),
    );

    await definition?.handler("path", infoCtx.ctx);
    assert.equal(
      lastNotification(infoCtx.notifications).message,
      `permission-system config: ${configPath}`,
    );

    await definition?.handler("help", infoCtx.ctx);
    assert.ok(
      lastNotification(infoCtx.notifications).message.includes(
        "Usage: /permission-system",
      ),
    );

    await definition?.handler("reset", infoCtx.ctx);
    assert.deepEqual(config, DEFAULT_EXTENSION_CONFIG);
    assert.equal(
      lastNotification(infoCtx.notifications).message,
      "Permission system settings reset to defaults.",
    );

    const persisted = JSON.parse(readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(persisted, DEFAULT_EXTENSION_CONFIG);

    await definition?.handler("unknown", infoCtx.ctx);
    assert.equal(lastNotification(infoCtx.notifications).level, "warning");
    assert.ok(
      lastNotification(infoCtx.notifications).message.includes(
        "Usage: /permission-system",
      ),
    );

    const headlessCtx = createCommandContext(false);
    await definition?.handler("", headlessCtx.ctx);
    assert.equal(
      lastNotification(headlessCtx.notifications).message,
      "/permission-system requires interactive TUI mode.",
    );

    const modalCtx = createCommandContext(true);
    await definition?.handler("", modalCtx.ctx);
    assert.equal(modalCtx.getCustomCalls(), 1);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("show output includes rule origins when getComposedRules is provided", async () => {
  const config = { ...DEFAULT_EXTENSION_CONFIG };
  const composedRules: Rule[] = [
    {
      surface: "read",
      pattern: "*",
      action: "allow",
      layer: "config",
      origin: "global",
    },
    {
      surface: "bash",
      pattern: "rm *",
      action: "deny",
      layer: "config",
      origin: "project",
    },
  ];

  const controller = {
    getConfig: () => config,
    setConfig: () => {},
    getConfigPath: () => "/fake/config.json",
    getComposedRules: () => composedRules,
  };

  let definition: {
    handler: (args: string, ctx: CommandContextStub) => Promise<void>;
  } | null = null;

  registerPermissionSystemCommand(
    {
      registerCommand(_name: string, nextDef: typeof definition) {
        definition = nextDef;
      },
    } as never,
    controller as never,
  );

  const ctx = createCommandContext(true);
  await definition!.handler("show", ctx.ctx);
  const msg = lastNotification(ctx.notifications).message;

  assert.ok(msg.includes("global"), `expected 'global' in: ${msg}`);
  assert.ok(msg.includes("project"), `expected 'project' in: ${msg}`);
  assert.ok(msg.includes("read"), `expected 'read' in: ${msg}`);
  assert.ok(msg.includes("bash"), `expected 'bash' in: ${msg}`);
});

test("show output omits rule summary when getComposedRules is not provided", async () => {
  const config = { ...DEFAULT_EXTENSION_CONFIG, yoloMode: true };

  const controller = {
    getConfig: () => config,
    setConfig: () => {},
    getConfigPath: () => "/fake/config.json",
    // no getComposedRules
  };

  let definition: {
    handler: (args: string, ctx: CommandContextStub) => Promise<void>;
  } | null = null;

  registerPermissionSystemCommand(
    {
      registerCommand(_name: string, nextDef: typeof definition) {
        definition = nextDef;
      },
    } as never,
    controller as never,
  );

  const ctx = createCommandContext(true);
  await definition!.handler("show", ctx.ctx);
  const msg = lastNotification(ctx.notifications).message;

  // Config knobs still present.
  assert.ok(msg.includes("yoloMode=on"), `expected yoloMode=on in: ${msg}`);
  // No rule annotation lines.
  assert.ok(!msg.includes("(global)"), `unexpected '(global)' in: ${msg}`);
});
