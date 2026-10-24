import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({ ALLOW_SIGNUP: true, MAX_SBOM_MB: 20 });
  });

  it("rejects a short secret and names the variable", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("reads ALLOW_SIGNUP=false", () => {
    expect(parseEnv({ ...valid, ALLOW_SIGNUP: "false" }).ALLOW_SIGNUP).toBe(false);
  });
});
