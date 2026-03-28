-- CreateTable
CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "case_count" INTEGER NOT NULL,
    "card_name_accuracy" DOUBLE PRECISION NOT NULL,
    "quantity_accuracy" DOUBLE PRECISION NOT NULL,
    "count_match_rate" DOUBLE PRECISION NOT NULL,
    "scryfall_resolved" DOUBLE PRECISION NOT NULL,
    "triggered_by" TEXT,
    "commit_sha" TEXT,
    "details" JSONB,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_eval_runs_ran_at" ON "eval_runs"("ran_at");
