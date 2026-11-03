CREATE TABLE `gift_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`pin_version` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gift_sessions_card_index` ON `gift_sessions` (`card_id`);--> statement-breakpoint
ALTER TABLE `cards` ADD `pin_hash` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `pin_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `pin_locked_until` integer DEFAULT 0 NOT NULL;