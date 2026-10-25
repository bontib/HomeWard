-- CreateEnum
CREATE TYPE "email_alert_state" AS ENUM ('OFF', 'PENDING_CONFIRM', 'ON');

-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('CONFIRM', 'TEST', 'INSTANT', 'DIGEST');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "job_type" ADD VALUE 'SEND_EMAIL';
ALTER TYPE "job_type" ADD VALUE 'SEND_DIGEST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "job_error_code" ADD VALUE 'SMTP_FAILED';
ALTER TYPE "job_error_code" ADD VALUE 'SMTP_NOT_CONFIGURED';

-- AlterTable
ALTER TABLE "finding" ADD COLUMN     "notification_id" TEXT,
ADD COLUMN     "notified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "worker_status" ADD COLUMN     "smtp_configured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "time_zone" TEXT;

-- CreateTable
CREATE TABLE "notification_pref" (
    "user_id" TEXT NOT NULL,
    "email_state" "email_alert_state" NOT NULL DEFAULT 'OFF',
    "confirm_nonce" TEXT,
    "unsubscribe_token" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "last_confirm_sent_at" TIMESTAMP(3),
    "last_test_at" TIMESTAMP(3),
    "last_instant_at" TIMESTAMP(3),
    "last_digest_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pref_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" TEXT NOT NULL,
    "kind" "notification_kind" NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'QUEUED',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "link_token" TEXT,
    "error_code" "job_error_code",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_user_id_created_at_idx" ON "notification"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "finding_notification_id_idx" ON "finding"("notification_id");

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_pref" ADD CONSTRAINT "notification_pref_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

