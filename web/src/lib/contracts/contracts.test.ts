import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as enums from "./enums";
import { JobPayloadSchemas } from "./jobs";
import { riskLevel } from "./risk";
import { JobTypeSchema } from "./enums";

const webRoot = path.resolve(__dirname, "../../..");
const contractsDir = path.resolve(webRoot, "../contracts");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

/** Maps each Prisma enum name (as written in the schema) to its variants. */
function prismaEnums(): Map<string, string[]> {
  const schema = readFileSync(path.join(webRoot, "prisma/schema.prisma"), "utf8");
  const result = new Map<string, string[]>();
  for (const match of schema.matchAll(/^enum (\w+) \{\n([\s\S]*?)^\}/gm)) {
    const [, name, body] = match;
    const variants = body!
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter((line) => line !== "" && !line.startsWith("@@"));
    result.set(name!, variants);
  }
  return result;
}

describe("enums match prisma/schema.prisma", () => {
  const zodByPrismaName: Record<string, readonly string[]> = {
    DeviceType: enums.DeviceTypeSchema.options,
    DeviceStatus: enums.DeviceStatusSchema.options,
    CheckState: enums.CheckStateSchema.options,
    Severity: enums.SeveritySchema.options,
    FindingState: enums.FindingStateSchema.options,
    FindingSource: enums.FindingSourceSchema.options,
    ComponentSource: enums.ComponentSourceSchema.options,
    ComponentCheck: enums.ComponentCheckSchema.options,
    SbomFormat: enums.SbomFormatSchema.options,
    JobType: enums.JobTypeSchema.options,
    JobStatus: enums.JobStatusSchema.options,
    JobErrorCode: enums.JobErrorCodeSchema.options,
    ProductSearchStatus: enums.ProductSearchStatusSchema.options,
    DataSourceId: enums.DataSourceIdSchema.options,
  };
  const fromSchema = prismaEnums();

  it("covers every enum in the schema", () => {
    expect([...fromSchema.keys()].sort()).toEqual(Object.keys(zodByPrismaName).sort());
  });

  it.each(Object.entries(zodByPrismaName))("%s has the same variants", (name, zodValues) => {
    expect([...zodValues]).toEqual(fromSchema.get(name));
  });
});

describe("job payload fixtures", () => {
  it("has a payload schema for every job type", () => {
    expect(Object.keys(JobPayloadSchemas).sort()).toEqual([...JobTypeSchema.options].sort());
  });

  it.each(jsonFiles(path.join(contractsDir, "jobs")))("accepts %s", (file) => {
    const type = path.basename(file, ".json") as keyof typeof JobPayloadSchemas;
    expect(JobPayloadSchemas[type].safeParse(readJson(file)).success).toBe(true);
  });

  it.each(jsonFiles(path.join(contractsDir, "jobs/invalid")))("rejects %s", (file) => {
    const type = path.basename(file).split(".")[0] as keyof typeof JobPayloadSchemas;
    expect(JobPayloadSchemas[type].safeParse(readJson(file)).success).toBe(false);
  });
});

describe("risk-levels.json", () => {
  const fixture = readJson(path.join(contractsDir, "risk-levels.json")) as {
    levels: {
      cvssScore: number | null;
      severity: enums.Severity;
      exploited: boolean;
      level: string;
    }[];
  };

  it.each(fixture.levels)("score $cvssScore, $severity, exploited $exploited is $level", (c) => {
    expect(riskLevel(c)).toBe(c.level);
  });
});
