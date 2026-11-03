ALTER TABLE `cards` ADD `gift_options` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `audio_key` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `activation_hash` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `seal_on_publish` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `sealed` integer DEFAULT 0 NOT NULL;