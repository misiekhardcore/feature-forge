import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { EOL, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RotatingFileSink, type RotatingFileSinkOptions } from "./RotatingFileSink";

describe("RotatingFileSink", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rfs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeOptions(overrides: Partial<RotatingFileSinkOptions> = {}): RotatingFileSinkOptions {
    return {
      directory: dir,
      filenamePrefix: "forge",
      filenameSuffix: "1234",
      maxBytes: 10_000,
      maxFiles: 5,
      ...overrides,
    };
  }

  it("appends lines to the base file without rotating under maxBytes", () => {
    const now = new Date("2026-03-02T10:00:00");
    const sink = new RotatingFileSink(
      makeOptions({ auditFile: join(dir, "audit.json"), now: () => now }),
    );
    expect(sink.write("first")).toBe(true);
    expect(sink.write("second")).toBe(true);
    expect(sink.write("third")).toBe(true);
    sink.close();

    const base = `forge.${RotatingFileSink.dayKey(now)}.1234.log`;
    expect(readdirSync(dir).sort()).toEqual([base, "audit.json"].sort());
    expect(readFileSync(join(dir, base), "utf8")).toBe(`first${EOL}second${EOL}third${EOL}`);
  });

  it("rotates by size: overflow moves to the next segment", () => {
    const line = "x".repeat(80);
    const lineBytes = Buffer.byteLength(line + EOL);
    const sink = new RotatingFileSink(makeOptions({ maxBytes: 100, dayRotation: false }));
    const base = "forge.1234.log";

    // Two 81-byte writes fill the base past maxBytes; rotation is evaluated
    // before the next append, so the overflow line opens segment .1.
    expect(sink.write(line)).toBe(true);
    expect(sink.write(line)).toBe(true);
    expect(statSync(join(dir, base)).size).toBe(2 * lineBytes);
    expect(existsSync(join(dir, `${base}.1`))).toBe(false);

    expect(sink.write(line)).toBe(true);
    expect(statSync(join(dir, base)).size).toBe(2 * lineBytes);
    expect(statSync(join(dir, `${base}.1`)).size).toBe(lineBytes);

    // When .1 exceeds maxBytes, following writes go to .2.
    expect(sink.write(line)).toBe(true);
    expect(sink.write(line)).toBe(true);
    expect(statSync(join(dir, `${base}.1`)).size).toBe(2 * lineBytes);
    expect(statSync(join(dir, `${base}.2`)).size).toBe(lineBytes);
    sink.close();

    expect(readdirSync(dir).sort()).toEqual([base, `${base}.1`, `${base}.2`].sort());
  });

  it("rotates by day: a new base file starts on day change with the index reset", () => {
    let clock = new Date("2026-01-15T10:00:00");
    const sink = new RotatingFileSink(
      makeOptions({ maxBytes: 50, now: () => clock, auditFile: join(dir, "audit.json") }),
    );
    const line = "x".repeat(30); // 31 bytes with EOL

    sink.write(line);
    sink.write(line);
    sink.write(line); // day 1: base + segment .1
    expect(
      readdirSync(dir)
        .filter((name) => name !== "audit.json")
        .sort(),
    ).toEqual(["forge.2026-01-15.1234.log", "forge.2026-01-15.1234.log.1"].sort());

    clock = new Date("2026-01-16T09:00:00");
    sink.write(line); // day 2: plain base file, no segment suffix
    sink.close();

    const names = readdirSync(dir).filter((name) => name !== "audit.json");
    expect(names).toContain("forge.2026-01-16.1234.log");
    expect(names).not.toContain("forge.2026-01-16.1234.log.1");
    expect(readFileSync(join(dir, "forge.2026-01-16.1234.log"), "utf8")).toBe(`${line}${EOL}`);

    // Day 1 files are untouched.
    expect(readFileSync(join(dir, "forge.2026-01-15.1234.log"), "utf8")).toBe(
      `${line}${EOL}${line}${EOL}`,
    );
    expect(readFileSync(join(dir, "forge.2026-01-15.1234.log.1"), "utf8")).toBe(`${line}${EOL}`);
  });

  it("keeps only the newest files when the audit ledger is enabled", () => {
    const auditPath = join(dir, "audit.json");
    const now = new Date("2026-03-02T10:00:00");
    const sink = new RotatingFileSink(
      makeOptions({ maxBytes: 50, maxFiles: 2, auditFile: auditPath, now: () => now }),
    );
    const line = "x".repeat(30); // 31 bytes with EOL
    const base = `forge.${RotatingFileSink.dayKey(now)}.1234.log`;

    sink.write(line);
    sink.write(line);
    sink.write(line); // .1 created
    sink.write(line);
    sink.write(line); // .2 created; the base is evicted by retention
    sink.close();

    expect(readdirSync(dir).sort()).toEqual([`${base}.1`, `${base}.2`, "audit.json"].sort());

    const audit = JSON.parse(readFileSync(auditPath, "utf8")) as {
      keep: { days: boolean; amount: number };
      auditLog: string;
      files: Array<{ date: number; name: string; hash: string }>;
      hashType: string;
    };
    expect(audit.keep).toEqual({ days: false, amount: 2 });
    expect(audit.auditLog).toBe(auditPath);
    expect(audit.hashType).toBe("sha256");
    expect(audit.files).toHaveLength(2);
    expect(audit.files.map((file) => file.name)).toEqual([
      join(dir, `${base}.1`),
      join(dir, `${base}.2`),
    ]);
    for (const entry of audit.files) {
      expect(typeof entry.date).toBe("number");
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("removes the oldest numeric segments when no audit file is set", () => {
    const sink = new RotatingFileSink(
      makeOptions({
        filenamePrefix: "agent-1",
        filenameSuffix: "journal",
        extension: "jsonl",
        dayRotation: false,
        maxBytes: 50,
        maxFiles: 2,
      }),
    );
    const line = "x".repeat(30); // 31 bytes with EOL
    const base = "agent-1.journal.jsonl";

    sink.write(line);
    sink.write(line); // base exceeds maxBytes
    sink.write(line); // .1
    sink.write(line); // .1 exceeds maxBytes
    sink.write(line); // .2
    sink.write(line); // .2 exceeds maxBytes
    sink.write(line); // .3 -> retention removes .1
    sink.close();

    expect(existsSync(join(dir, base))).toBe(true);
    expect(existsSync(join(dir, `${base}.2`))).toBe(true);
    expect(existsSync(join(dir, `${base}.3`))).toBe(true);
    expect(existsSync(join(dir, `${base}.1`))).toBe(false);
    expect(existsSync(join(dir, "audit.json"))).toBe(false);
  });

  it("keeps segments strictly chronological across a day boundary in journal mode", () => {
    let clock = new Date("2026-01-15T23:59:00");
    const sink = new RotatingFileSink(
      makeOptions({ maxBytes: 50, maxFiles: 2, dayRotation: false, now: () => clock }),
    );
    const line = "x".repeat(30); // 31 bytes with EOL
    const base = "forge.1234.log";

    // Day 1: base + .2 + .3 (retention evicted .1); the active .3 is full.
    for (let i = 0; i < 8; i++) {
      sink.write(line);
    }
    expect(existsSync(join(dir, `${base}.1`))).toBe(false);
    expect(existsSync(join(dir, `${base}.3`))).toBe(true);

    clock = new Date("2026-01-16T00:00:30");
    sink.write(line); // day 2: must NOT reset to index 0 or reuse the evicted .1
    sink.close();

    // The day-2 record opens a fresh segment above every day-1 segment, so
    // 0->N replay stays chronological.
    expect(existsSync(join(dir, `${base}.4`))).toBe(true);
    expect(readFileSync(join(dir, `${base}.4`), "utf8")).toBe(`${line}${EOL}`);
    // The base still holds only day-1 records.
    expect(readFileSync(join(dir, base), "utf8")).toBe(`${line}${EOL}${line}${EOL}`);
    expect(existsSync(join(dir, `${base}.1`))).toBe(false);
  });

  it("resumes at the newest segment instead of recreating evicted low indices", () => {
    const line = "x".repeat(30); // 31 bytes with EOL
    const base = "forge.1234.log";
    const options = makeOptions({ maxBytes: 50, maxFiles: 2, dayRotation: false });

    // First instance: base + .2 + .3 retained; .1 evicted by retention.
    const first = new RotatingFileSink(options);
    for (let i = 0; i < 7; i++) {
      first.write(line);
    }
    first.close();
    expect(existsSync(join(dir, `${base}.1`))).toBe(false);
    expect(existsSync(join(dir, `${base}.2`))).toBe(true);
    expect(existsSync(join(dir, `${base}.3`))).toBe(true);

    // Second instance: appends must continue from the newest segment (.3),
    // not recreate the evicted .1 (which would sort BEFORE .2/.3 in replay).
    const second = new RotatingFileSink(options);
    second.write(line);
    second.close();

    expect(existsSync(join(dir, `${base}.1`))).toBe(false);
    expect(
      readFileSync(join(dir, `${base}.3`), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(2);
    expect(readFileSync(join(dir, `${base}.2`), "utf8")).toBe(`${line}${EOL}${line}${EOL}`);
  });

  it("omits the trailing dot when the extension is empty", () => {
    const sink = new RotatingFileSink(makeOptions({ dayRotation: false, extension: "" }));
    sink.write("line");
    sink.close();

    const names = readdirSync(dir);
    expect(names).toEqual(["forge.1234"]);
    expect(readFileSync(join(dir, "forge.1234"), "utf8")).toBe(`line${EOL}`);
  });

  it("write returns false instead of throwing when the directory is unusable", () => {
    const notADir = join(dir, "file-as-dir");
    writeFileSync(notADir, "i am a file, not a directory");
    const sink = new RotatingFileSink(makeOptions({ directory: notADir, dayRotation: false }));

    expect(() => sink.write("boom")).not.toThrow();
    expect(sink.write("boom")).toBe(false);
    expect(() => sink.close()).not.toThrow();
  });

  it("writes after close are no-ops", () => {
    const sink = new RotatingFileSink(makeOptions({ dayRotation: false }));
    expect(sink.write("before")).toBe(true);
    sink.close();
    expect(sink.write("after")).toBe(false);
    expect(() => sink.close()).not.toThrow(); // close is idempotent

    const entries = readdirSync(dir);
    expect(entries).toHaveLength(1);
    const [name] = entries;
    expect(readFileSync(join(dir, name), "utf8")).toBe(`before${EOL}`);
  });

  it("counts previously tracked files across instance recreation", () => {
    const auditPath = join(dir, "audit.json");
    const now = new Date("2026-03-02T10:00:00");
    const options = makeOptions({
      maxBytes: 50,
      maxFiles: 2,
      auditFile: auditPath,
      now: () => now,
    });
    const line = "x".repeat(30); // 31 bytes with EOL
    const base = `forge.${RotatingFileSink.dayKey(now)}.1234.log`;

    const first = new RotatingFileSink(options);
    for (let i = 0; i < 5; i++) {
      first.write(line); // base + .1 + .2 registered; base evicted
    }
    first.close();
    expect(readdirSync(dir).sort()).toEqual([`${base}.1`, `${base}.2`, "audit.json"].sort());

    // The ledger persists: the old .1 is still the oldest tracked entry, so
    // the fresh base registered by the new instance evicts it.
    const second = new RotatingFileSink(options);
    second.write(line);
    expect(existsSync(join(dir, `${base}.1`))).toBe(false);
    expect(existsSync(join(dir, base))).toBe(true);
    expect(existsSync(join(dir, `${base}.2`))).toBe(true);

    for (let i = 0; i < 4; i++) {
      second.write(line);
    }
    second.close();

    const audit = JSON.parse(readFileSync(auditPath, "utf8")) as {
      files: Array<{ date: number; name: string; hash: string }>;
    };
    expect(audit.files).toHaveLength(2);
    for (const entry of audit.files) {
      expect(existsSync(entry.name)).toBe(true);
    }
    expect(readdirSync(dir).sort()).toEqual([`${base}.1`, `${base}.2`, "audit.json"].sort());
  });

  it("never deletes audit-tracked paths outside the sink directory", () => {
    const auditPath = join(dir, "audit.json");
    const now = new Date("2026-03-02T10:00:00");
    const base = `forge.${RotatingFileSink.dayKey(now)}.1234.log`;

    // A tampered ledger: the oldest entry points OUTSIDE the sink's
    // directory, the second points at a real file inside it.
    const outsidePath = join(
      tmpdir(),
      `rfs-outside-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    const insidePath = join(dir, "keep-me.log");
    writeFileSync(outsidePath, "precious\n");
    writeFileSync(insidePath, "inside\n");
    const ledger = {
      keep: { days: false, amount: 1 },
      auditLog: auditPath,
      files: [
        { date: 1, name: outsidePath, hash: "0".repeat(64) },
        { date: 2, name: insidePath, hash: "1".repeat(64) },
      ],
      hashType: "sha256",
    };
    writeFileSync(auditPath, JSON.stringify(ledger));

    // maxFiles 1: the fresh active file pushes the count past the cap, so
    // both tracked entries are evicted. The outside path must survive.
    const sink = new RotatingFileSink(
      makeOptions({ maxBytes: 50, maxFiles: 1, auditFile: auditPath, now: () => now }),
    );
    expect(sink.write("x".repeat(30))).toBe(true);
    sink.close();

    expect(existsSync(outsidePath)).toBe(true);
    expect(existsSync(insidePath)).toBe(false);
    // The sink kept working: the record landed in the active file.
    expect(readFileSync(join(dir, base), "utf8")).toBe(`${"x".repeat(30)}${EOL}`);
    rmSync(outsidePath, { force: true });
  });

  describe("constructor validation", () => {
    it("rejects maxBytes that is not positive", () => {
      expect(() => new RotatingFileSink(makeOptions({ maxBytes: 0, dayRotation: false }))).toThrow(
        /maxBytes/,
      );
      expect(() => new RotatingFileSink(makeOptions({ maxBytes: -1, dayRotation: false }))).toThrow(
        /maxBytes/,
      );
    });

    it("rejects negative maxFiles", () => {
      expect(() => new RotatingFileSink(makeOptions({ maxFiles: -1, dayRotation: false }))).toThrow(
        /maxFiles/,
      );
    });

    it("requires an auditFile when dayRotation is enabled", () => {
      expect(() => new RotatingFileSink(makeOptions({ dayRotation: true }))).toThrow(/auditFile/);
      expect(() => new RotatingFileSink(makeOptions())).toThrow(/auditFile/);
    });

    it("accepts valid option combinations", () => {
      expect(() => new RotatingFileSink(makeOptions({ dayRotation: false }))).not.toThrow();
      expect(
        () => new RotatingFileSink(makeOptions({ maxFiles: 0, dayRotation: false })),
      ).not.toThrow();
      expect(
        () => new RotatingFileSink(makeOptions({ auditFile: join(dir, "audit.json") })),
      ).not.toThrow();
    });
  });
});
