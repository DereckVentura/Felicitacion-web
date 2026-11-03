CREATE TABLE `app_owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "one_owner" CHECK("app_owner"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_owner_user_id_unique` ON `app_owner` (`user_id`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`recipient` text NOT NULL,
	`sender` text DEFAULT '' NOT NULL,
	`occasion` text DEFAULT 'especial' NOT NULL,
	`theme` text DEFAULT 'rosa' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`letter` text DEFAULT '' NOT NULL,
	`edit_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cards_theme_valid" CHECK("cards"."theme" IN ('rosa', 'olivo', 'noche')),
	CONSTRAINT "cards_status_valid" CHECK("cards"."status" IN ('draft', 'published'))
);
--> statement-breakpoint
CREATE INDEX `cards_store_index` ON `cards` (`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cards_edit_hash_unique` ON `cards` (`edit_hash`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`card_id` text,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `credit_ledger_store_index` ON `credit_ledger` (`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_card_unique` ON `credit_ledger` (`card_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photos_storage_key_unique` ON `photos` (`storage_key`);--> statement-breakpoint
CREATE INDEX `photos_card_index` ON `photos` (`card_id`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`credits` integer DEFAULT 0 NOT NULL,
	`invite_hash` text,
	`invite_expires_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "stores_nonnegative_credits" CHECK("stores"."credits" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_email_unique` ON `stores` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `stores_user_unique` ON `stores` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stores_invite_unique` ON `stores` (`invite_hash`);
--> statement-breakpoint
-- Append to the initial generated schema migration, before its first application.
-- Every inserted card atomically debits one credit and leaves an audit record.
CREATE TRIGGER cards_debit_credit AFTER INSERT ON cards
BEGIN
  UPDATE stores SET credits = credits - 1
  WHERE id = NEW.store_id AND credits >= 1;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'INSUFFICIENT_CREDITS') END;
  INSERT INTO credit_ledger (id, store_id, card_id, amount, reason, note, actor_id, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.store_id, NEW.id, -1, 'card_activation', '', NEW.created_by, NEW.created_at);
END;

-- Enforce the photo quota in SQLite, including concurrent uploads.
CREATE TRIGGER photos_limit BEFORE INSERT ON photos
BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM photos WHERE card_id = NEW.card_id) >= 5
  THEN RAISE(ABORT, 'PHOTO_LIMIT') END;
END;

