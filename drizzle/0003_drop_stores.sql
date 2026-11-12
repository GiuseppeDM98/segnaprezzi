-- Stores are retired (2026-11-12). A product is one thing wherever it is
-- bought, so the index no longer compares each store with itself and the app
-- no longer records where a price was seen. Entries and sessions stay; only
-- the link to a store goes.
--
-- Written by hand over drizzle-kit's output, which was three statements:
-- DROP TABLE stores and ALTER TABLE ... DROP COLUMN store_id on both tables.
-- SQLite refuses to drop a column named in a table-level FOREIGN KEY clause
-- ("unknown column store_id in foreign key definition"), so both tables are
-- rebuilt without it.
--
-- The order is what keeps price_entries.session_id alive. The migrator runs
-- this file in one transaction, where PRAGMA foreign_keys is a no-op, so the
-- keys stay enforced: dropping shopping_sessions while a price_entries still
-- points at it would fire ON DELETE SET NULL on every entry. The new entries
-- table therefore references the NEW sessions table from the start, both old
-- tables go while nothing references them, and the renames rewrite the
-- reference to the final name.
CREATE TABLE `__new_shopping_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_shopping_sessions` (`id`, `user_id`, `status`, `started_at`, `completed_at`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `status`, `started_at`, `completed_at`, `created_at`, `updated_at` FROM `shopping_sessions`;
--> statement-breakpoint
CREATE TABLE `__new_price_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`session_id` text,
	`recorded_at` integer NOT NULL,
	`total_price_cents` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`package_size` real NOT NULL,
	`unit_price_milli` integer NOT NULL,
	`is_promo` integer DEFAULT false NOT NULL,
	`promo_kind` text,
	`source` text NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`photo_url` text,
	`ai_confidence` real,
	`ai_model` text,
	`ai_raw_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `__new_shopping_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_price_entries` (`id`, `user_id`, `product_id`, `session_id`, `recorded_at`, `total_price_cents`, `quantity`, `package_size`, `unit_price_milli`, `is_promo`, `promo_kind`, `source`, `currency`, `photo_url`, `ai_confidence`, `ai_model`, `ai_raw_json`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `product_id`, `session_id`, `recorded_at`, `total_price_cents`, `quantity`, `package_size`, `unit_price_milli`, `is_promo`, `promo_kind`, `source`, `currency`, `photo_url`, `ai_confidence`, `ai_model`, `ai_raw_json`, `created_at`, `updated_at` FROM `price_entries`;
--> statement-breakpoint
DROP TABLE `price_entries`;
--> statement-breakpoint
DROP TABLE `shopping_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_shopping_sessions` RENAME TO `shopping_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_price_entries` RENAME TO `price_entries`;
--> statement-breakpoint
CREATE INDEX `shopping_sessions_user_id_idx` ON `shopping_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `price_entries_user_product_recorded_idx` ON `price_entries` (`user_id`,`product_id`,`recorded_at`);
--> statement-breakpoint
CREATE INDEX `price_entries_user_recorded_idx` ON `price_entries` (`user_id`,`recorded_at`);
--> statement-breakpoint
DROP TABLE `stores`;
