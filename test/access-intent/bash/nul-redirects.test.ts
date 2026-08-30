import { describe, expect, it } from "vitest";
import {
  extractNulRedirects,
  type NulRedirectTarget,
} from "#src/access-intent/bash/nul-redirects";
import { getParser } from "#src/access-intent/bash/parser";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parse a bash snippet and extract its nul redirect targets under a flavor. */
async function extract(
  cmd: string,
  flavor: typeof win32PathFlavor,
): Promise<NulRedirectTarget[]> {
  const parser = await getParser();
  const tree = parser.parse(cmd);
  if (!tree) throw new Error("parser.parse returned null");
  try {
    return extractNulRedirects(tree.rootNode, flavor);
  } finally {
    tree.delete();
  }
}

/** Extract under the win32 flavor (Git Bash reserved-name semantics). */
const win = (cmd: string) => extract(cmd, win32PathFlavor);

/** Extract under the POSIX flavor (nul is a legal filename there). */
const posix = (cmd: string) => extract(cmd, posixPathFlavor);

// ── Write redirects (deny on win32) ─────────────────────────────────────────

describe("extractNulRedirects — write redirects", () => {
  it("detects a bare >nul stdout redirect", async () => {
    expect(await win("echo hi > nul")).toEqual([
      { token: "nul", mode: "write" },
    ]);
  });

  it("detects a glued >nul", async () => {
    expect(await win("echo hi >nul")).toEqual([
      { token: "nul", mode: "write" },
    ]);
  });

  it("detects 2>NUL (stderr, uppercase)", async () => {
    expect(await win("ls 2>NUL")).toEqual([{ token: "NUL", mode: "write" }]);
  });

  it("detects 2>nul with space before target", async () => {
    expect(await win("echo hi 2> nul")).toEqual([
      { token: "nul", mode: "write" },
    ]);
  });

  it("detects >> append to nul", async () => {
    expect(await win("echo x >> nul")).toEqual([
      { token: "nul", mode: "write" },
    ]);
  });

  it("detects &>nul and &>>nul", async () => {
    expect(await win("cmd &> nul")).toEqual([{ token: "nul", mode: "write" }]);
    expect(await win("cmd &>>nul")).toEqual([{ token: "nul", mode: "write" }]);
  });

  it("detects 1>nul with explicit fd", async () => {
    expect(await win("cmd 1>nul")).toEqual([{ token: "nul", mode: "write" }]);
  });

  it("keeps only the nul hit in a chained command", async () => {
    const hits = await win("where python 2>nul && dir 2>&1 | tee out.log");
    expect(hits).toEqual([{ token: "nul", mode: "write" }]);
  });

  it("collects every nul redirect across a chained command", async () => {
    const hits = await win("a > nul; b 2>NUL; c >>nul");
    expect(hits).toEqual([
      { token: "nul", mode: "write" },
      { token: "NUL", mode: "write" },
      { token: "nul", mode: "write" },
    ]);
  });

  it("detects nul with a reserved extension (nul.txt)", async () => {
    expect(await win("echo x > nul.txt")).toEqual([
      { token: "nul.txt", mode: "write" },
    ]);
  });

  it("is case-insensitive on the reserved basename (NuL, NUL.com)", async () => {
    expect(await win("cmd > NuL")).toEqual([{ token: "NuL", mode: "write" }]);
    expect(await win("cmd > NUL.com")).toEqual([
      { token: "NUL.com", mode: "write" },
    ]);
  });

  it("classifies < nul as a read redirect", async () => {
    expect(await win("cat < nul")).toEqual([{ token: "nul", mode: "read" }]);
  });
});

// ── Non-targets (allow) ─────────────────────────────────────────────────────

describe("extractNulRedirects — non-targets", () => {
  it("does not flag /dev/null", async () => {
    expect(await win("cmd > /dev/null")).toEqual([]);
  });

  it("does not flag a plain argument 'nul' (no redirect)", async () => {
    expect(await win("echo nul")).toEqual([]);
  });

  it("does not flag a quoted non-nul redirect target", async () => {
    expect(await win("echo x > 'out.txt'")).toEqual([]);
  });

  it("does not descend into heredoc bodies", async () => {
    expect(await win("cat <<'EOF'\nfoo > nul\nEOF")).toEqual([]);
  });

  it("does not flag a remote payload inside quotes (ssh/cmd strings)", async () => {
    expect(await win('ssh host "where python 2>nul"')).toEqual([]);
    expect(await win('cmd.exe /d /c "where wg 2>NUL"')).toEqual([]);
  });

  it("does not flag nul-as-substring filenames (manual.txt, null)", async () => {
    expect(await win("echo x > manual.txt")).toEqual([]);
    expect(await win("echo x > null")).toEqual([]);
  });

  it("does not flag paths that merely end in /nul on another directory", async () => {
    expect(await win("echo x > /dev/null")).toEqual([]);
    expect(await win("echo x > sub/nul.txt")).toEqual([
      { token: "sub/nul.txt", mode: "write" },
    ]);
  });
});

// ── POSIX non-triggering ────────────────────────────────────────────────────

describe("extractNulRedirects — POSIX flavor", () => {
  it("returns [] on POSIX (nul is a legal filename there)", async () => {
    expect(await posix("echo hi > nul")).toEqual([]);
    expect(await posix("cmd 2>NUL")).toEqual([]);
    expect(await posix("cmd > nul.txt")).toEqual([]);
  });
});
