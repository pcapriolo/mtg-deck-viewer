-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "author_id" TEXT,
    "author_username" TEXT,
    "tweet_text" TEXT,
    "image_count" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "ocr_success" BOOLEAN NOT NULL DEFAULT false,
    "ocr_pass_count" INTEGER NOT NULL DEFAULT 0,
    "ocr_cards_extracted" INTEGER NOT NULL DEFAULT 0,
    "ocr_time_ms" INTEGER NOT NULL DEFAULT 0,
    "ocr_expected_count" INTEGER,
    "ocr_correction_ran" BOOLEAN NOT NULL DEFAULT false,
    "ocr_correction_accepted" BOOLEAN NOT NULL DEFAULT false,
    "scryfall_cards_resolved" INTEGER NOT NULL DEFAULT 0,
    "scryfall_cards_not_found" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scryfall_time_ms" INTEGER NOT NULL DEFAULT 0,
    "reply_sent" BOOLEAN NOT NULL DEFAULT false,
    "reply_tweet_id" TEXT,
    "reply_variant" TEXT,
    "reply_time_ms" INTEGER NOT NULL DEFAULT 0,
    "deck_name" TEXT,
    "deck_url" TEXT,
    "decklist_text" TEXT,
    "mainboard_count" INTEGER NOT NULL DEFAULT 0,
    "sideboard_count" INTEGER NOT NULL DEFAULT 0,
    "total_time_ms" INTEGER NOT NULL DEFAULT 0,
    "utm_id" TEXT,
    "healing_ran" BOOLEAN NOT NULL DEFAULT false,
    "healing_accepted" BOOLEAN NOT NULL DEFAULT false,
    "user_feedback" TEXT,
    "feedback_applied" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagements" (
    "id" TEXT NOT NULL,
    "utm_id" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_interactions_tweet_id" ON "interactions"("tweet_id");

-- CreateIndex
CREATE INDEX "idx_interactions_conversation_id" ON "interactions"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_interactions_created_at" ON "interactions"("created_at");

-- CreateIndex
CREATE INDEX "idx_engagements_utm_id" ON "engagements"("utm_id");
