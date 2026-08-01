import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const VALID_STORAGE   = ["kv", "db", "none"];
const VALID_AUDIENCES = ["everyone", "adults", "children"];

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });

  it("entrypoint is index.html", () => expect(manifest.entrypoint).toBe("index.html"));
  it("runtime is static",        () => expect(manifest.runtime).toBe("static"));

  it("storage is declared and valid", () => {
    expect(manifest.storage, "storage field is required").toBeTruthy();
    expect(VALID_STORAGE).toContain(manifest.storage);
  });

  it("version follows semver", () => expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/));

  it("permissions.default_audience is valid", () => {
    expect(VALID_AUDIENCES).toContain(manifest.permissions.default_audience);
  });

  it("data_access has reads and writes arrays", () => {
    expect(Array.isArray(manifest.data_access.reads)).toBe(true);
    expect(Array.isArray(manifest.data_access.writes)).toBe(true);
  });
});

// ── automation_actions ↔ migrations ──────────────────────────────────────────
//
// The hub validates automation steps for identifier hygiene and for unresolved
// `:param` references, but it never compares them against this app's schema. A
// renamed column or a missing NOT NULL value would therefore surface only when
// a rule fires in a real household, as a failed run in someone's history. These
// tests are that missing check.

const AUTOMATION_PREFIX = `app_${manifest.id.replace(/-/g, "_")}__`;

function migrationSchema() {
  const dir = join(__dirname, "../migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf-8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");

  const tables = {};
  const createRe = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  for (let m; (m = createRe.exec(sql)); ) {
    const cols = {};
    for (const raw of m[2].split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      const name = line.split(/\s+/)[0];
      if (!name || /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(name)) continue;
      cols[name] = {
        notNull: /NOT\s+NULL/i.test(line) || /PRIMARY\s+KEY/i.test(line),
        hasDefault: /DEFAULT/i.test(line),
      };
    }
    tables[m[1]] = cols;
  }
  const alterRe = /ALTER\s+TABLE\s+([A-Za-z_]\w*)\s+ADD\s+COLUMN\s+([A-Za-z_]\w*)([^;]*);/gi;
  for (let m; (m = alterRe.exec(sql)); ) {
    if (tables[m[1]]) {
      tables[m[1]][m[2]] = { notNull: /NOT\s+NULL/i.test(m[3]), hasDefault: /DEFAULT/i.test(m[3]) };
    }
  }
  return tables;
}

describe.skipIf(!manifest.automation_actions)("automation_actions match the migrations", () => {
  const schema = migrationSchema();
  const table = (name) => schema[`${AUTOMATION_PREFIX}${name}`];
  const actions = Object.entries(manifest.automation_actions ?? {});

  for (const [actionId, action] of actions) {
    describe(actionId, () => {
      it("every step names a table this app actually has", () => {
        for (const step of action.steps) {
          expect(table(step.table), `unknown table: ${step.table}`).toBeTruthy();
        }
      });

      it("every referenced column exists", () => {
        for (const step of action.steps) {
          const cols = table(step.table) ?? {};
          const referenced = [
            ...Object.keys(step.values ?? {}),
            ...Object.keys(step.set ?? {}),
            ...Object.keys(step.where ?? {}),
            ...Object.values(step.bind ?? {}),
          ];
          for (const col of referenced) {
            expect(cols[col], `${step.table}.${col} is not in the migrations`).toBeTruthy();
          }
        }
      });

      it("inserts supply every column that is NOT NULL without a default", () => {
        for (const step of action.steps) {
          if (step.op !== "insert") continue;
          const cols = table(step.table) ?? {};
          for (const [col, spec] of Object.entries(cols)) {
            if (!spec.notNull || spec.hasDefault) continue;
            expect(
              step.values[col],
              `${step.table}.${col} is NOT NULL with no default, so the insert must set it`,
            ).toBeTruthy();
          }
        }
      });

      it("the dedupe column exists and is plaintext", () => {
        if (!action.dedupe) return;
        const cols = table(action.dedupe.table) ?? {};
        expect(cols[action.dedupe.column], `unknown dedupe column: ${action.dedupe.column}`).toBeTruthy();
        // The guard matches with `WHERE col = ?`. Encryption uses a random IV,
        // so an encrypted column would never match and every event would apply
        // twice — silently. Plaintext is by suffix convention or declaration.
        const plain =
          manifest.db_encryption === "off" ||
          /(_id|_at|_date|_by)$/.test(action.dedupe.column) ||
          (manifest.db_plaintext_columns ?? []).includes(action.dedupe.column);
        expect(plain, `${action.dedupe.column} would be encrypted at rest`).toBe(true);
      });

      it("lookup WHERE columns are plaintext", () => {
        for (const step of action.steps) {
          if (step.op === "insert") continue;
          for (const col of Object.keys(step.where ?? {})) {
            const plain =
              manifest.db_encryption === "off" ||
              /(_id|_at|_date|_by)$/.test(col) ||
              (manifest.db_plaintext_columns ?? []).includes(col);
            expect(plain, `${step.table}.${col} is compared in SQL but would be encrypted`).toBe(true);
          }
        }
      });
    });
  }

  it("suggestions that target this app name a declared action", () => {
    for (const s of manifest.suggested_automations ?? []) {
      if (s.target_app_id !== manifest.id) continue;
      expect(manifest.automation_actions[s.action_id], `unknown action: ${s.action_id}`).toBeTruthy();
    }
  });

  it("suggestions map every required param of the action they target", () => {
    for (const s of manifest.suggested_automations ?? []) {
      if (s.target_app_id !== manifest.id) continue;
      const params = manifest.automation_actions[s.action_id].params;
      for (const [name, spec] of Object.entries(params)) {
        if (!spec.required) continue;
        expect(s.param_map?.[name], `"${s.title}" does not map required param "${name}"`).toBeTruthy();
      }
    }
  });
});
