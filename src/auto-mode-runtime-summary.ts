export interface AutoModeWorkspaceContext {
  kind?: string;
  agentName?: string;
  worktreeCwd?: string;
  parentCwd?: string;
}

export interface AutoModePathAlias {
  lexical?: string;
  projectRelative?: string;
  worktreeAbsolute?: string;
  parentEquivalent?: string;
}

export interface AutoModeRuntimeContext {
  cwd?: string;
  entries?: readonly unknown[];
  workspace?: AutoModeWorkspaceContext;
  pathAliases?: readonly AutoModePathAlias[];
}

export function runtimeSummary(
  runtime: AutoModeRuntimeContext | undefined,
): string {
  if (!runtime) return "";
  return [
    runtime.cwd ? `CWD: ${runtime.cwd}` : "",
    workspaceSummary(runtime.workspace),
    pathAliasSummary(runtime.pathAliases),
    recentEntries(runtime.entries),
  ]
    .filter(Boolean)
    .join("\n");
}

function workspaceSummary(
  workspace: AutoModeWorkspaceContext | undefined,
): string {
  if (!workspace) return "";
  return [
    workspace.kind ? `Workspace: ${workspace.kind}` : "",
    workspace.agentName ? `Agent: ${workspace.agentName}` : "",
    workspace.parentCwd ? `Parent project root: ${workspace.parentCwd}` : "",
    workspace.worktreeCwd ? `Worktree root: ${workspace.worktreeCwd}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function pathAliasSummary(
  aliases: readonly AutoModePathAlias[] | undefined,
): string {
  return (aliases ?? []).map(pathAliasLines).filter(Boolean).join("\n");
}

function pathAliasLines(alias: AutoModePathAlias): string {
  return [
    alias.lexical ? `Lexical path: ${alias.lexical}` : "",
    alias.projectRelative
      ? `Project-relative path: ${alias.projectRelative}`
      : "",
    alias.worktreeAbsolute
      ? `Worktree absolute path: ${alias.worktreeAbsolute}`
      : "",
    alias.parentEquivalent
      ? `Parent-equivalent path: ${alias.parentEquivalent}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function recentEntries(entries: readonly unknown[] | undefined): string {
  const text = (entries ?? [])
    .slice(-6)
    .map(entryText)
    .filter(Boolean)
    .join("\n");
  return text ? `Recent conversation:\n${limit(text, 3000)}` : "";
}

function entryText(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (!isRecord(entry)) return "";
  const content = entry.content ?? entry.text ?? entry.message ?? entry.data;
  return typeof content === "string"
    ? content
    : JSON.stringify(content ?? entry);
}

function limit(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
