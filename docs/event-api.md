# Event API

The extension emits events on Pi's `pi.events` bus so other extensions can observe permission decisions and integrate with the policy system without importing this package.

## Stability Guarantee

Fields may be added to any payload, but existing fields will not be removed or renamed without a semver-major version bump.
The protocol version constant is exported from `src/permission-events.ts` and embedded in every RPC reply.

## Channel Reference

|Channel|Direction|When|Payload type|
|---|---|---|---|
|`permissions:ready`|Broadcast|Once, immediately after load|`PermissionsReadyEvent`|
|`permissions:decision`|Broadcast|After every gate resolution|`PermissionDecisionEvent`|
|`permissions:rpc:check`|Request|On-demand|`PermissionsCheckRequest`|
|`permissions:rpc:check:reply:<requestId>`|Reply|After each check request|`PermissionsRpcReply<PermissionsCheckReplyData>`|
|`permissions:rpc:prompt`|Request|On-demand|`PermissionsPromptRequest`|
|`permissions:rpc:prompt:reply:<requestId>`|Reply|After prompt is resolved|`PermissionsRpcReply<PermissionsPromptReplyData>`|

---

## Decision Broadcasts

Every permission gate resolution emits a `permissions:decision` event, regardless of outcome.
This is useful for dashboards, telemetry, or audit overlays.

```typescript
pi.events.on("permissions:decision", (raw) => {
  const event = raw as import("@gotgenes/pi-permission-system").PermissionDecisionEvent;
  console.log(event.surface, event.result, event.resolution);
  // e.g. "bash" "allow" "user_approved_for_session"
});
```

### Payload Fields

|Field|Type|Description|
|---|---|---|
|`surface`|`string`|Permission surface (`"bash"`, `"read"`, `"mcp"`, `"skill"`, `"external_directory"`, etc.)|
|`value`|`string`|Value evaluated (command, tool name, skill name, path)|
|`result`|`"allow" \| "deny"`|Final outcome|
|`resolution`|`string`|How the outcome was reached (see table below)|
|`origin`|`string \| null`|Config scope that contributed the winning rule|
|`agentName`|`string \| null`|Active agent name when known|
|`matchedPattern`|`string \| null`|Pattern from the winning rule|

### Resolution Values

|Value|Meaning|
|---|---|
|`policy_allow`|Config rule said allow — no prompt shown|
|`policy_deny`|Config rule said deny — blocked immediately|
|`session_approved`|Covered by a session-level approval from earlier in the same session|
|`infrastructure_auto_allowed`|Read of a Pi infrastructure path — auto-allowed|
|`user_approved`|User approved once via dialog|
|`user_approved_for_session`|User approved for the rest of the session|
|`user_denied`|User denied via dialog|
|`auto_approved`|Yolo mode — approved automatically without dialog|
|`confirmation_unavailable`|State was `ask` but no UI was available — blocked|

---

## Policy Query RPC

Other extensions can evaluate the current permission policy without importing this package.
The call is synchronous-style: emit a request, listen on a scoped reply channel.

```typescript
const requestId = crypto.randomUUID();

// Listen for the reply first
const unsub = pi.events.on(
  `permissions:rpc:check:reply:${requestId}`,
  (raw) => {
    unsub();
    const reply = raw as import("@gotgenes/pi-permission-system").PermissionsRpcReply<
      import("@gotgenes/pi-permission-system").PermissionsCheckReplyData
    >;
    if (reply.success) {
      console.log(reply.data?.result); // "allow" | "deny" | "ask"
    }
  },
);

// Then emit the request
pi.events.emit("permissions:rpc:check", {
  requestId,
  surface: "bash",
  value: "git push",
  agentName: "Worker", // optional
});
```

If the extension is not loaded, no reply arrives.
Callers should implement a timeout and treat no-reply as `deny` (graceful degradation).

### Request Fields

|Field|Required|Description|
|---|---|---|
|`requestId`|Yes|Unique string; scopes the reply channel|
|`surface`|Yes|Permission surface to evaluate|
|`value`|No|Value to evaluate (command, name, path); defaults to `"*"`|
|`agentName`|No|Agent name for per-agent policy resolution|

### Reply Data Fields (`PermissionsCheckReplyData`)

|Field|Type|Description|
|---|---|---|
|`result`|`"allow" \| "deny" \| "ask"`|Policy decision (including active session rules)|
|`matchedPattern`|`string \| null`|Matched rule pattern|
|`origin`|`string \| null`|Config scope of the winning rule|

---

## Prompt Forwarding RPC

In-process child sessions (e.g. tintinweb/pi-subagents running via `createAgentSession()`) cannot use file-based permission forwarding because no child process is spawned.
They can instead forward permission prompts to the parent session's UI via this RPC.

```typescript
const requestId = crypto.randomUUID();

const unsub = pi.events.on(
  `permissions:rpc:prompt:reply:${requestId}`,
  (raw) => {
    unsub();
    const reply = raw as import("@gotgenes/pi-permission-system").PermissionsRpcReply<
      import("@gotgenes/pi-permission-system").PermissionsPromptReplyData
    >;
    if (reply.success && reply.data?.approved) {
      // proceed
    } else {
      // deny — either user denied or no UI was available (error: "no_ui")
    }
  },
);

pi.events.emit("permissions:rpc:prompt", {
  requestId,
  surface: "bash",
  value: "rm -rf /tmp/build",
  message: "Allow rm -rf /tmp/build?",
  agentName: "Explore",      // optional
  sessionLabel: "Allow rm *", // optional — label for the "for this session" option
});
```

The handler replies with `{ success: false, error: "no_ui" }` when no interactive session is available.

### Successful Reply Fields

|Field|Type|Description|
|---|---|---|
|`approved`|`boolean`|Whether the user approved|
|`state`|`string`|`"approved"`, `"approved_for_session"`, `"denied"`, or `"denied_with_reason"`|
|`denialReason`|`string` (optional)|User-provided denial reason|

---

## Ready Event

The extension emits `permissions:ready` once immediately after it loads.
Consumers that start after the extension can check via a ping-style RPC check — the `permissions:rpc:check` handler is active as long as the extension is loaded.

```typescript
pi.events.on("permissions:ready", (raw) => {
  const event = raw as import("@gotgenes/pi-permission-system").PermissionsReadyEvent;
  console.log("Permission system loaded, protocol version:", event.protocolVersion);
});
```
