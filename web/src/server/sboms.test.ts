import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import {
  checkUpload,
  cleanFileName,
  detectSbomFormat,
  jsonDepth,
  MAX_JSON_DEPTH,
  UNSUPPORTED_MESSAGE,
} from "./sboms";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("detectSbomFormat", () => {
  it("recognises CycloneDX", () => {
    expect(detectSbomFormat(bytes('{"bomFormat": "CycloneDX", "specVersion": "1.5"}'))).toBe(
      "CYCLONEDX",
    );
  });

  it("recognises SPDX", () => {
    expect(detectSbomFormat(bytes('{"spdxVersion":"SPDX-2.3","packages":[]}'))).toBe("SPDX");
  });

  it("works when the marker is not the first key", () => {
    expect(detectSbomFormat(bytes('{"version":1,\n "bomFormat" : "CycloneDX"}'))).toBe("CYCLONEDX");
  });

  it("accepts a byte order mark and leading whitespace", () => {
    expect(detectSbomFormat(bytes('\uFEFF  \n{"bomFormat":"CycloneDX"}'))).toBe("CYCLONEDX");
  });

  it("refuses other JSON, XML and plain text", () => {
    expect(detectSbomFormat(bytes('{"name":"package.json"}'))).toBeNull();
    expect(detectSbomFormat(bytes('<?xml version="1.0"?><bom bomFormat="CycloneDX"/>'))).toBeNull();
    expect(detectSbomFormat(bytes("hello"))).toBeNull();
    expect(detectSbomFormat(new Uint8Array())).toBeNull();
  });

  it("refuses a marker that is only mentioned in text", () => {
    expect(detectSbomFormat(bytes('["bomFormat", "CycloneDX"]'))).toBeNull();
  });

  it("only looks at the first 64 KB", () => {
    const padding = " ".repeat(70 * 1024);
    expect(detectSbomFormat(bytes(`{"a":"${padding}","bomFormat":"CycloneDX"}`))).toBeNull();
  });
});

describe("jsonDepth", () => {
  it("counts nested objects and arrays", () => {
    expect(jsonDepth(bytes('{"a":[{"b":1}]}'))).toBe(3);
    expect(jsonDepth(bytes("1"))).toBe(0);
  });

  it("ignores brackets inside strings, including escaped quotes", () => {
    expect(jsonDepth(bytes('{"a":"[[[[ \\" ]]]]"}'))).toBe(1);
  });

  it("finds a deeply nested file", () => {
    const deep = "[".repeat(5000) + "]".repeat(5000);
    expect(jsonDepth(bytes(deep))).toBe(5000);
  });
});

describe("checkUpload", () => {
  const cyclonedx = '{"bomFormat":"CycloneDX","components":[]}';

  it("returns the format of a good file", () => {
    expect(checkUpload(bytes(cyclonedx), 20)).toBe("CYCLONEDX");
  });

  it("refuses a file over the limit with 413", () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    expect(() => checkUpload(big, 2)).toThrowError(
      expect.objectContaining({
        code: "PAYLOAD_TOO_LARGE",
        message: "This file is larger than 2 MB.",
      }),
    );
  });

  it("refuses a file that is not an SBOM with 415 and the agreed text", () => {
    expect(() => checkUpload(bytes('{"hello":1}'), 20)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_FILE", message: UNSUPPORTED_MESSAGE }),
    );
  });

  it("refuses JSON nested past the parser's limit", () => {
    const nested = '{"bomFormat":"CycloneDX","x":' + "[".repeat(MAX_JSON_DEPTH + 1);
    expect(() => checkUpload(bytes(nested + "]".repeat(MAX_JSON_DEPTH + 1) + "}"), 20)).toThrow(
      AppError,
    );
  });
});

describe("cleanFileName", () => {
  it("keeps only the file name, whatever the path looks like", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("C:\\Users\\me\\sbom.json")).toBe("sbom.json");
  });

  it("removes control characters and caps the length", () => {
    expect(cleanFileName("a\u0000b\nc.json")).toBe("abc.json");
    expect(cleanFileName("x".repeat(500))).toHaveLength(255);
  });

  it("falls back to a plain name", () => {
    expect(cleanFileName("")).toBe("sbom.json");
    expect(cleanFileName("../")).toBe("sbom.json");
  });
});
