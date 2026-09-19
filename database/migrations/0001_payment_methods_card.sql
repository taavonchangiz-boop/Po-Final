ALTER TABLE `payments` MODIFY `gateway` ENUM('ZARINPAL','IDPAY','ZIBAL','MOCK','CARD') NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` MODIFY `status` ENUM('CREATED','REDIRECTED','VERIFIED','FAILED','REFUNDED','PENDING') NOT NULL DEFAULT 'CREATED';--> statement-breakpoint
ALTER TABLE `payments` ADD `method` ENUM('ONLINE','CARD') NOT NULL DEFAULT 'ONLINE';--> statement-breakpoint
ALTER TABLE `payments` ADD `reference` varchar(64);--> statement-breakpoint
CREATE INDEX `ix_payments_method` ON `payments` (`method`,`status`);
