-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "device_type" AS ENUM ('CONSOLE', 'PC', 'LAPTOP', 'PHONE', 'TABLET', 'TV', 'SPEAKER', 'CAMERA', 'PLUG', 'BULB', 'THERMOSTAT', 'ROUTER', 'DOORBELL', 'PRINTER', 'NAS', 'OTHER');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('PENDING', 'CRITICAL', 'VULNERABLE', 'UPDATE_AVAILABLE', 'NO_KNOWN_VULNS', 'NOT_TRACKED');

-- CreateEnum
CREATE TYPE "check_state" AS ENUM ('IDLE', 'CHECKING', 'FAILED');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "finding_state" AS ENUM ('OPEN', 'IGNORED');

-- CreateEnum
CREATE TYPE "finding_source" AS ENUM ('NVD', 'TRIVY');

-- CreateEnum
CREATE TYPE "component_source" AS ENUM ('MANUAL', 'SBOM');

-- CreateEnum
CREATE TYPE "component_check" AS ENUM ('PENDING', 'CHECKED', 'NO_IDENTIFIER', 'NO_VERSION', 'BAD_VERSION', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "sbom_format" AS ENUM ('CYCLONEDX', 'SPDX');

-- CreateEnum
CREATE TYPE "job_type" AS ENUM ('CHECK_DEVICE', 'RECOMPUTE_STATUS', 'SEARCH_PRODUCTS', 'RESCAN_ALL', 'UPDATE_TRIVY_DB', 'IMPORT_KEV', 'DEV_NOOP');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "job_error_code" AS ENUM ('NVD_UNAVAILABLE', 'TRIVY_FAILED', 'TRIVY_DB_MISSING', 'SBOM_INVALID', 'KEV_UNAVAILABLE', 'TIMEOUT', 'WORKER_LOST', 'BAD_PAYLOAD', 'INTERNAL');

-- CreateEnum
CREATE TYPE "product_search_status" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "data_source_id" AS ENUM ('NVD', 'TRIVY_DB', 'KEV');

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "device_type" NOT NULL,
    "room" VARCHAR(40),
    "notes" VARCHAR(500),
    "status" "device_status" NOT NULL DEFAULT 'PENDING',
    "target_version" TEXT,
    "open_finding_count" INTEGER NOT NULL DEFAULT 0,
    "component_count" INTEGER NOT NULL DEFAULT 0,
    "unchecked_count" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMP(3),
    "check_state" "check_state" NOT NULL DEFAULT 'IDLE',
    "check_job_id" TEXT,
    "check_error_code" "job_error_code",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "component" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "device_id" TEXT NOT NULL,
    "source" "component_source" NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "vendor" TEXT,
    "purl" TEXT,
    "cpe" TEXT,
    "check" "component_check" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sbom" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "device_id" TEXT NOT NULL,
    "format" "sbom_format" NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsed_at" TIMESTAMP(3),

    CONSTRAINT "sbom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "version_change" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "component_id" TEXT NOT NULL,
    "from_version" TEXT,
    "to_version" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "version_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vulnerability" (
    "id" TEXT NOT NULL,
    "severity" "severity" NOT NULL,
    "cvss_score" DOUBLE PRECISION,
    "cvss_vector" TEXT,
    "exploited" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "modified_at" TIMESTAMP(3),
    "reference_urls" JSONB NOT NULL DEFAULT '[]',
    "nvd_configurations" JSONB,
    "details_source" "finding_source" NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vulnerability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "device_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "vulnerability_id" TEXT NOT NULL,
    "source" "finding_source" NOT NULL,
    "fixed_version" TEXT,
    "state" "finding_state" NOT NULL DEFAULT 'OPEN',
    "ignored_reason" VARCHAR(200),
    "ignored_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpe_product" (
    "cpe" TEXT NOT NULL,
    "part" CHAR(1) NOT NULL,
    "vendor" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "latest_version" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "cves_fetched_at" TIMESTAMP(3),

    CONSTRAINT "cpe_product_pkey" PRIMARY KEY ("cpe")
);

-- CreateTable
CREATE TABLE "cpe_product_cve" (
    "cpe" TEXT NOT NULL,
    "vulnerability_id" TEXT NOT NULL,

    CONSTRAINT "cpe_product_cve_pkey" PRIMARY KEY ("cpe","vulnerability_id")
);

-- CreateTable
CREATE TABLE "product_search" (
    "query" VARCHAR(60) NOT NULL,
    "status" "product_search_status" NOT NULL,
    "cpes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "job_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetched_at" TIMESTAMP(3),

    CONSTRAINT "product_search_pkey" PRIMARY KEY ("query")
);

-- CreateTable
CREATE TABLE "kev_entry" (
    "cve_id" TEXT NOT NULL,
    "date_added" DATE NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kev_entry_pkey" PRIMARY KEY ("cve_id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "type" "job_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "run_after" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "error_code" "job_error_code",
    "error" TEXT,
    "user_id" TEXT,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_source" (
    "id" "data_source_id" NOT NULL,
    "last_attempt_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "data_updated_at" TIMESTAMP(3),
    "last_error_code" "job_error_code",

    CONSTRAINT "data_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_status" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3) NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,
    "version" TEXT NOT NULL,
    "rescan_cron" TEXT NOT NULL,
    "next_rescan_at" TIMESTAMP(3),
    "nvd_api_key_set" BOOLEAN NOT NULL,

    CONSTRAINT "worker_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "account"("user_id");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "device_user_id_created_at_idx" ON "device"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "component_device_id_source_idx" ON "component"("device_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "sbom_device_id_key" ON "sbom"("device_id");

-- CreateIndex
CREATE INDEX "version_change_component_id_changed_at_idx" ON "version_change"("component_id", "changed_at");

-- CreateIndex
CREATE INDEX "finding_device_id_state_idx" ON "finding"("device_id", "state");

-- CreateIndex
CREATE INDEX "finding_vulnerability_id_idx" ON "finding"("vulnerability_id");

-- CreateIndex
CREATE UNIQUE INDEX "finding_component_id_vulnerability_id_key" ON "finding"("component_id", "vulnerability_id");

-- CreateIndex
CREATE INDEX "cpe_product_cve_vulnerability_id_idx" ON "cpe_product_cve"("vulnerability_id");

-- CreateIndex
CREATE INDEX "job_status_priority_run_after_idx" ON "job"("status", "priority" DESC, "run_after");

-- CreateIndex
CREATE INDEX "job_user_id_created_at_idx" ON "job"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_device_id_idx" ON "job"("device_id");

-- CreateIndex
CREATE INDEX "job_type_created_at_idx" ON "job"("type", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component" ADD CONSTRAINT "component_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sbom" ADD CONSTRAINT "sbom_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_change" ADD CONSTRAINT "version_change_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_vulnerability_id_fkey" FOREIGN KEY ("vulnerability_id") REFERENCES "vulnerability"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpe_product_cve" ADD CONSTRAINT "cpe_product_cve_cpe_fkey" FOREIGN KEY ("cpe") REFERENCES "cpe_product"("cpe") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpe_product_cve" ADD CONSTRAINT "cpe_product_cve_vulnerability_id_fkey" FOREIGN KEY ("vulnerability_id") REFERENCES "vulnerability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

