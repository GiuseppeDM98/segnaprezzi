CREATE TABLE `product_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`alias` text NOT NULL,
	`store_chain` text,
	`hit_count` integer DEFAULT 1 NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_aliases_user_alias_chain_idx` ON `product_aliases` (`user_id`,`alias`,`store_chain`);--> statement-breakpoint
CREATE INDEX `product_aliases_product_idx` ON `product_aliases` (`product_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`store_id` text,
	`status` text DEFAULT 'extracted' NOT NULL,
	`purchased_at` integer NOT NULL,
	`receipt_total_cents` integer NOT NULL,
	`line_count` integer NOT NULL,
	`content_hash` text NOT NULL,
	`file_kind` text NOT NULL,
	`ai_model` text NOT NULL,
	`ai_raw_json` text NOT NULL,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `receipts_user_id_idx` ON `receipts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_user_hash_idx` ON `receipts` (`user_id`,`content_hash`);--> statement-breakpoint
ALTER TABLE `price_entries` ADD `receipt_id` text REFERENCES receipts(id);--> statement-breakpoint
ALTER TABLE `price_entries` ADD `quantity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `default_package_size` real;
--> statement-breakpoint
-- Backfill: every product that already has history gets the package size of
-- its newest observation, so the first receipt imported after this
-- migration can resolve a unit price without asking the user.
UPDATE products SET default_package_size = (
  SELECT pe.package_size FROM price_entries pe
  WHERE pe.product_id = products.id AND pe.package_size > 0
  ORDER BY pe.recorded_at DESC LIMIT 1
) WHERE default_package_size IS NULL;
