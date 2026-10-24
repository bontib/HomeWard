// Zod enums for every Postgres enum. Source of truth: web/prisma/schema.prisma.
// A test compares these lists with the enum blocks in the schema (ADR 0003).
import { z } from "zod";

export const DeviceTypeSchema = z.enum([
  "CONSOLE",
  "PC",
  "LAPTOP",
  "PHONE",
  "TABLET",
  "TV",
  "SPEAKER",
  "CAMERA",
  "PLUG",
  "BULB",
  "THERMOSTAT",
  "ROUTER",
  "DOORBELL",
  "PRINTER",
  "NAS",
  "OTHER",
]);
export const DeviceStatusSchema = z.enum([
  "PENDING",
  "CRITICAL",
  "VULNERABLE",
  "UPDATE_AVAILABLE",
  "NO_KNOWN_VULNS",
  "NOT_TRACKED",
]);
export const CheckStateSchema = z.enum(["IDLE", "CHECKING", "FAILED"]);
export const SeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
export const FindingStateSchema = z.enum(["OPEN", "IGNORED"]);
export const FindingSourceSchema = z.enum(["NVD", "TRIVY"]);
export const ComponentSourceSchema = z.enum(["MANUAL", "SBOM"]);
export const ComponentCheckSchema = z.enum([
  "PENDING",
  "CHECKED",
  "NO_IDENTIFIER",
  "NO_VERSION",
  "BAD_VERSION",
  "UNSUPPORTED",
]);
export const SbomFormatSchema = z.enum(["CYCLONEDX", "SPDX"]);
export const JobTypeSchema = z.enum([
  "CHECK_DEVICE",
  "RECOMPUTE_STATUS",
  "SEARCH_PRODUCTS",
  "RESCAN_ALL",
  "UPDATE_TRIVY_DB",
  "IMPORT_KEV",
  "DEV_NOOP",
]);
export const JobStatusSchema = z.enum(["QUEUED", "RUNNING", "DONE", "FAILED"]);
export const JobErrorCodeSchema = z.enum([
  "NVD_UNAVAILABLE",
  "TRIVY_FAILED",
  "TRIVY_DB_MISSING",
  "SBOM_INVALID",
  "KEV_UNAVAILABLE",
  "TIMEOUT",
  "WORKER_LOST",
  "BAD_PAYLOAD",
  "INTERNAL",
]);
export const DataSourceIdSchema = z.enum(["NVD", "TRIVY_DB", "KEV"]);
// One TS type per schema: export type DeviceType = z.infer<typeof DeviceTypeSchema>; etc.

export type DeviceType = z.infer<typeof DeviceTypeSchema>;
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;
export type CheckState = z.infer<typeof CheckStateSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type FindingState = z.infer<typeof FindingStateSchema>;
export type FindingSource = z.infer<typeof FindingSourceSchema>;
export type ComponentSource = z.infer<typeof ComponentSourceSchema>;
export type ComponentCheck = z.infer<typeof ComponentCheckSchema>;
export type SbomFormat = z.infer<typeof SbomFormatSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobErrorCode = z.infer<typeof JobErrorCodeSchema>;
export type DataSourceId = z.infer<typeof DataSourceIdSchema>;

export const ProductSearchStatusSchema = z.enum(["PENDING", "READY", "FAILED"]);
export type ProductSearchStatus = z.infer<typeof ProductSearchStatusSchema>;
