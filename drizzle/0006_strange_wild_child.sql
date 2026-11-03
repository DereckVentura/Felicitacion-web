CREATE TABLE `legal_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`version` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legal_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `removal_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`email` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `removal_requests_card_id_unique` ON `removal_requests` (`card_id`);--> statement-breakpoint
ALTER TABLE `cards` ADD `consent_at` integer;--> statement-breakpoint
ALTER TABLE `cards` ADD `consent_version` text;