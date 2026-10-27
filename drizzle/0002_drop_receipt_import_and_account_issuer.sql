-- Receipt import is retired (2026-10-27). The owner chose to drop the
-- observations it produced together with the feature: they go first, while
-- price_entries.source still admits the value, and the index is recomputed
-- without them on the next request.
DELETE FROM price_entries WHERE source = 'receipt';--> statement-breakpoint
DROP TABLE `product_aliases`;--> statement-breakpoint
DROP TABLE `receipts`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `issuer`;--> statement-breakpoint
ALTER TABLE `price_entries` DROP COLUMN `receipt_id`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `default_package_size`;