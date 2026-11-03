DROP INDEX `stores_email_unique`;--> statement-breakpoint
DROP INDEX `stores_user_unique`;--> statement-breakpoint
DROP INDEX `stores_invite_unique`;--> statement-breakpoint
ALTER TABLE `stores` ADD `logo_key` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `logo_mime` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `logo_mode` text DEFAULT 'original' NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `deleted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `stores_email_unique` ON `stores` (`email`) WHERE "stores"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `stores_user_unique` ON `stores` (`user_id`) WHERE "stores"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `stores_invite_unique` ON `stores` (`invite_hash`) WHERE "stores"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `print_color` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `logo_mode` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `deleted_at` integer;
--> statement-breakpoint
-- Keep deletions effective if an in-flight activation crosses the administrative delete.
CREATE TRIGGER cards_store_active BEFORE INSERT ON cards
WHEN NOT EXISTS (SELECT 1 FROM stores WHERE id = NEW.store_id AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'STORE_DELETED');
END;
--> statement-breakpoint
CREATE TRIGGER orders_store_active BEFORE INSERT ON orders
WHEN NOT EXISTS (SELECT 1 FROM stores WHERE id = NEW.store_id AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'STORE_DELETED');
END;
--> statement-breakpoint
CREATE TRIGGER orders_store_active_approval BEFORE UPDATE OF status ON orders
WHEN NEW.status = 'approved' AND OLD.status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM stores WHERE id = NEW.store_id AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'STORE_DELETED');
END;
--> statement-breakpoint
CREATE TRIGGER photos_card_active BEFORE INSERT ON photos
WHEN NOT EXISTS (SELECT 1 FROM cards c JOIN stores s ON s.id = c.store_id
  WHERE c.id = NEW.card_id AND c.deleted_at IS NULL AND s.deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'CARD_DELETED');
END;
