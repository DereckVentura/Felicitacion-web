CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`package_id` text NOT NULL,
	`package_name` text NOT NULL,
	`kind` text NOT NULL,
	`credits` integer,
	`price_cents` integer,
	`currency` text NOT NULL,
	`duration_days` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_status_valid" CHECK("orders"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "orders_kind_valid" CHECK("orders"."kind" IN ('credits', 'unlimited')),
	CONSTRAINT "orders_quantity_valid" CHECK(("orders"."kind" = 'credits' AND "orders"."credits" BETWEEN 1 AND 10000 AND "orders"."duration_days" IS NULL) OR ("orders"."kind" = 'unlimited' AND "orders"."credits" IS NULL AND ("orders"."duration_days" IS NULL OR "orders"."duration_days" > 0)))
);
--> statement-breakpoint
CREATE INDEX `orders_store_index` ON `orders` (`store_id`);--> statement-breakpoint
CREATE TABLE `packages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`credits` integer,
	`price_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`duration_days` integer,
	`active` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "packages_kind_valid" CHECK("packages"."kind" IN ('credits', 'unlimited')),
	CONSTRAINT "packages_active_valid" CHECK("packages"."active" IN (0, 1)),
	CONSTRAINT "packages_price_valid" CHECK("packages"."price_cents" IS NULL OR "packages"."price_cents" >= 0),
	CONSTRAINT "packages_quantity_valid" CHECK(("packages"."kind" = 'credits' AND "packages"."credits" BETWEEN 1 AND 10000 AND "packages"."duration_days" IS NULL) OR ("packages"."kind" = 'unlimited' AND "packages"."credits" IS NULL AND ("packages"."duration_days" IS NULL OR "packages"."duration_days" > 0)))
);
--> statement-breakpoint
ALTER TABLE `credit_ledger` ADD `order_id` text REFERENCES orders(id);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_order_unique` ON `credit_ledger` (`order_id`);--> statement-breakpoint
ALTER TABLE `stores` ADD `unlimited` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `unlimited_until` integer;
--> statement-breakpoint
-- Append only to the NEW V2 schema migration before its first application.
-- Existing applied migrations remain immutable.
DROP TRIGGER IF EXISTS cards_debit_credit;
CREATE TRIGGER cards_debit_credit AFTER INSERT ON cards
BEGIN
  UPDATE stores SET credits = credits - CASE
    WHEN unlimited = 1 AND (unlimited_until IS NULL OR unlimited_until > NEW.created_at) THEN 0 ELSE 1 END
  WHERE id = NEW.store_id AND (
    (unlimited = 1 AND (unlimited_until IS NULL OR unlimited_until > NEW.created_at)) OR credits >= 1
  );
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'INSUFFICIENT_CREDITS') END;
  INSERT INTO credit_ledger (id, store_id, card_id, amount, reason, note, actor_id, created_at)
  SELECT lower(hex(randomblob(16))), NEW.store_id, NEW.id,
    CASE WHEN unlimited = 1 AND (unlimited_until IS NULL OR unlimited_until > NEW.created_at) THEN 0 ELSE -1 END,
    CASE WHEN unlimited = 1 AND (unlimited_until IS NULL OR unlimited_until > NEW.created_at) THEN 'unlimited_card_activation' ELSE 'card_activation' END,
    '', NEW.created_by, NEW.created_at
  FROM stores WHERE id = NEW.store_id;
END;

-- A conditional pending -> approved update grants exactly once in the same transaction.
CREATE TRIGGER orders_grant_approval AFTER UPDATE OF status ON orders
WHEN OLD.status = 'pending' AND NEW.status = 'approved'
BEGIN
  SELECT CASE WHEN NEW.decided_at IS NULL OR NEW.decided_by IS NULL
    THEN RAISE(ABORT, 'ORDER_DECISION_REQUIRED') END;
  UPDATE stores SET credits = credits + NEW.credits
  WHERE id = NEW.store_id AND NEW.kind = 'credits';
  UPDATE stores SET unlimited_until = CASE
      WHEN unlimited = 1 AND unlimited_until IS NULL THEN NULL
      WHEN NEW.duration_days IS NULL THEN NULL
      ELSE (CASE WHEN unlimited = 1 AND unlimited_until > NEW.decided_at
        THEN unlimited_until ELSE NEW.decided_at END) + NEW.duration_days * 86400000
    END,
    unlimited = 1
  WHERE id = NEW.store_id AND NEW.kind = 'unlimited';
  INSERT INTO credit_ledger (id, store_id, order_id, amount, reason, note, actor_id, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.store_id, NEW.id,
    CASE WHEN NEW.kind = 'credits' THEN NEW.credits ELSE 0 END,
    'order_approval', NEW.note, NEW.decided_by, NEW.decided_at);
END;

CREATE TRIGGER orders_decision_final BEFORE UPDATE OF status ON orders
WHEN OLD.status != 'pending' AND NEW.status != OLD.status
BEGIN
  SELECT RAISE(ABORT, 'ORDER_ALREADY_DECIDED');
END;

CREATE TRIGGER orders_snapshot_immutable BEFORE UPDATE OF package_id, package_name, kind, credits, price_cents, currency, duration_days, store_id ON orders
WHEN NEW.package_id IS NOT OLD.package_id OR NEW.package_name IS NOT OLD.package_name
  OR NEW.kind IS NOT OLD.kind OR NEW.credits IS NOT OLD.credits OR NEW.price_cents IS NOT OLD.price_cents
  OR NEW.currency IS NOT OLD.currency OR NEW.duration_days IS NOT OLD.duration_days OR NEW.store_id IS NOT OLD.store_id
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SNAPSHOT_IMMUTABLE');
END;

