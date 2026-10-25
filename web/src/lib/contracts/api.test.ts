import { describe, expect, it } from "vitest";
import {
  CreateDeviceSchema,
  NotificationLinkQuerySchema,
  NotificationTokenSchema,
  ProductSearchQuerySchema,
  SendTestEmailSchema,
  SetEmailAlertsSchema,
  UpdateDeviceSchema,
  UpdateFindingSchema,
} from "./api";

const validDevice = {
  type: "CONSOLE",
  name: "Living room Xbox",
  product: { kind: "other", name: "Xbox One" },
  version: "10.0.1",
};

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message;
}

describe("CreateDeviceSchema", () => {
  it("accepts a device with a free-text product", () => {
    expect(CreateDeviceSchema.safeParse(validDevice).success).toBe(true);
  });

  it("turns empty room, notes and version into null", () => {
    const parsed = CreateDeviceSchema.parse({ ...validDevice, room: " ", notes: "", version: "" });
    expect([parsed.room, parsed.notes, parsed.version]).toEqual([null, null, null]);
  });

  it("asks for a name", () => {
    const result = CreateDeviceSchema.safeParse({ ...validDevice, name: "  " });
    expect(firstMessage(result)).toBe("Give your device a name.");
  });

  it("rejects an unknown device type", () => {
    expect(CreateDeviceSchema.safeParse({ ...validDevice, type: "TOASTER" }).success).toBe(false);
  });

  it("accepts a catalog product with a base CPE", () => {
    const product = { kind: "catalog", cpe: "cpe:2.3:o:microsoft:xbox_one_firmware" };
    expect(CreateDeviceSchema.safeParse({ ...validDevice, product }).success).toBe(true);
  });

  it("rejects a CPE that already has a version", () => {
    const product = { kind: "catalog", cpe: "cpe:2.3:o:microsoft:xbox_one_firmware:10.0" };
    expect(CreateDeviceSchema.safeParse({ ...validDevice, product }).success).toBe(false);
  });
});

describe("UpdateDeviceSchema", () => {
  it("rejects an empty change", () => {
    expect(firstMessage(UpdateDeviceSchema.safeParse({}))).toBe("Change at least one field.");
  });

  it("accepts a version change alone", () => {
    expect(UpdateDeviceSchema.safeParse({ version: "11.0" }).success).toBe(true);
  });
});

describe("ProductSearchQuerySchema", () => {
  it("normalizes case and spaces", () => {
    expect(ProductSearchQuerySchema.parse({ q: "  Xbox   ONE " }).q).toBe("xbox one");
  });

  it("asks for at least 2 letters", () => {
    expect(firstMessage(ProductSearchQuerySchema.safeParse({ q: "x" }))).toBe(
      "Type at least 2 letters.",
    );
  });
});

describe("UpdateFindingSchema", () => {
  it("needs a reason to ignore", () => {
    expect(firstMessage(UpdateFindingSchema.safeParse({ state: "IGNORED", reason: " " }))).toBe(
      "Add a short reason.",
    );
  });

  it("reopens without a reason", () => {
    expect(UpdateFindingSchema.safeParse({ state: "OPEN" }).success).toBe(true);
  });
});

describe("SetEmailAlertsSchema", () => {
  it("accepts a boolean", () => {
    expect(SetEmailAlertsSchema.safeParse({ enabled: true }).success).toBe(true);
  });

  it("rejects a string and extra fields", () => {
    expect(SetEmailAlertsSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(SetEmailAlertsSchema.safeParse({ enabled: true, userId: "x" }).success).toBe(false);
  });
});

describe("SendTestEmailSchema", () => {
  it("accepts only an empty object", () => {
    expect(SendTestEmailSchema.safeParse({}).success).toBe(true);
    expect(SendTestEmailSchema.safeParse({ to: "a@b.c" }).success).toBe(false);
  });
});

describe("NotificationTokenSchema", () => {
  const token = "v1.eyJwIjoiY29uZmlybSJ9.c2lnbmF0dXJl";

  it("accepts a base64url token", () => {
    expect(NotificationTokenSchema.safeParse({ token }).success).toBe(true);
  });

  it.each([
    ["too short", "v1.abc"],
    ["too long", "a".repeat(513)],
    ["bad characters", "v1.abc def ghi jkl mno pqr"],
  ])("rejects a token that is %s", (_name, bad) => {
    expect(NotificationTokenSchema.safeParse({ token: bad }).success).toBe(false);
  });

  it("needs a known purpose for the link query", () => {
    expect(NotificationLinkQuerySchema.safeParse({ token, purpose: "confirm" }).success).toBe(true);
    expect(NotificationLinkQuerySchema.safeParse({ token, purpose: "other" }).success).toBe(false);
  });
});
