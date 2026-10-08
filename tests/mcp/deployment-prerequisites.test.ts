import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {APPLICATION_DATABASE_FUNCTIONS,APPLICATION_DATABASE_COLUMNS} from "@/domain/application/database-contract";
describe("shared-workflow deployment guard",()=>{
  it("gates Vercel builds on the read-only prerequisite check",()=>{
    const project=JSON.parse(readFileSync(new URL("../../vercel.json",import.meta.url),"utf8"));
    const npm=JSON.parse(readFileSync(new URL("../../package.json",import.meta.url),"utf8"));
    expect(project.buildCommand).toBe("npm run build:verified");
    expect(npm.scripts["build:verified"]).toBe("npm run check:application-db && npm run build");
  });
  it("includes the account and journal contracts that browser pages depend on",()=>{
    expect(APPLICATION_DATABASE_FUNCTIONS).toContain("private.application_account_read(jsonb)");
    expect(APPLICATION_DATABASE_FUNCTIONS).toContain("private.application_account_ledger(jsonb)");
    expect(APPLICATION_DATABASE_FUNCTIONS).toContain("private.application_journal_write(jsonb)");
    expect(APPLICATION_DATABASE_COLUMNS).toContainEqual({table:"daily_logs",column:"record_version"});
  });
  it("has no duplicate release prerequisites",()=>{
    expect(new Set(APPLICATION_DATABASE_FUNCTIONS).size).toBe(APPLICATION_DATABASE_FUNCTIONS.length);
    expect(new Set(APPLICATION_DATABASE_COLUMNS.map(item=>`${item.table}.${item.column}`)).size).toBe(APPLICATION_DATABASE_COLUMNS.length);
  });
});
