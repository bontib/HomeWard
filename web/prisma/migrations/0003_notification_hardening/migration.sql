-- AlterTable
ALTER TABLE "notification_pref" ADD COLUMN     "confirm_send_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unsubscribe_nonce" TEXT;

-- CreateTable
CREATE TABLE "confirm_send" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confirm_send_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "confirm_send_email_created_at_idx" ON "confirm_send"("email", "created_at");

-- CreateIndex
CREATE INDEX "confirm_send_created_at_idx" ON "confirm_send"("created_at");
