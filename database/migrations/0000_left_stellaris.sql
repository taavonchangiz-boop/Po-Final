CREATE TABLE `ai_jobs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`bot_id` bigint,
	`provider` enum('OPENAI','GEMINI','DEEPSEEK','CLAUDE','OPENROUTER','MISTRAL','CUSTOM') NOT NULL,
	`model` varchar(80),
	`purpose` enum('COPY','RESPOND','SUMMARY','CUSTOM') NOT NULL,
	`input` json NOT NULL,
	`output` text,
	`status` enum('QUEUED','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'QUEUED',
	`error_class` varchar(24),
	`error` text,
	`credits_used` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `ai_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`period_month` varchar(7) NOT NULL,
	`credits` int NOT NULL DEFAULT 0,
	`request_count` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_usage_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ai_usage` UNIQUE(`user_id`,`period_month`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`actor_user_id` bigint,
	`action` varchar(60) NOT NULL,
	`subject_type` varchar(40),
	`subject_id` bigint,
	`ip` varchar(45),
	`user_agent` varchar(255),
	`data` json NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`bot_id` bigint NOT NULL,
	`provider` enum('TELEGRAM','BALE','RUBIKA') NOT NULL,
	`external_event_id` varchar(128),
	`type` varchar(40) NOT NULL,
	`chat_id` varchar(64),
	`sender_ref` varchar(64),
	`payload` json NOT NULL,
	`processed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bot_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bot_events_dedupe` UNIQUE(`bot_id`,`external_event_id`)
);
--> statement-breakpoint
CREATE TABLE `bot_users` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`bot_id` bigint NOT NULL,
	`provider` enum('TELEGRAM','BALE','RUBIKA') NOT NULL,
	`external_user_id` varchar(64) NOT NULL,
	`display_name` varchar(190),
	`first_seen_at` timestamp NOT NULL DEFAULT (now()),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bot_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bot_users` UNIQUE(`bot_id`,`external_user_id`)
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`provider` enum('TELEGRAM','BALE','RUBIKA') NOT NULL,
	`token_encrypted` text NOT NULL,
	`username` varchar(64),
	`title` varchar(190),
	`is_enabled` boolean NOT NULL DEFAULT true,
	`status` enum('PENDING','ACTIVE','ERROR','DISABLED') NOT NULL DEFAULT 'PENDING',
	`webhook_secret` varchar(64) NOT NULL,
	`webhook_state` enum('UNREGISTERED','REGISTERED','POLLING','FAILED') NOT NULL DEFAULT 'UNREGISTERED',
	`commands` json NOT NULL DEFAULT ('[]'),
	`ai_config` json,
	`last_error` text,
	`last_verified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`provider` enum('TELEGRAM','BALE','RUBIKA') NOT NULL,
	`kind` enum('CHANNEL','GROUP','BOT_CHAT') NOT NULL DEFAULT 'CHANNEL',
	`chat_id` varchar(64) NOT NULL,
	`title` varchar(190) NOT NULL,
	`username` varchar(64),
	`credentials_encrypted` text NOT NULL,
	`status` enum('PENDING','ACTIVE','ERROR','DISCONNECTED') NOT NULL DEFAULT 'PENDING',
	`last_error` text,
	`last_verified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_channels_owner` UNIQUE(`user_id`,`provider`,`chat_id`)
);
--> statement-breakpoint
CREATE TABLE `daily_stats` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`stat_date` date NOT NULL,
	`metric` varchar(60) NOT NULL,
	`subject_type` varchar(40),
	`subject_id` bigint,
	`value` bigint NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_daily_stats` UNIQUE(`user_id`,`stat_date`,`metric`,`subject_type`,`subject_id`)
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`post_id` bigint NOT NULL,
	`channel_id` bigint NOT NULL,
	`user_id` bigint NOT NULL,
	`state` enum('PENDING','PROCESSING','SENT','RETRYING','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`next_attempt_at` timestamp,
	`last_error` text,
	`error_class` varchar(24),
	`provider_message_id` varchar(128),
	`sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_deliveries_post_channel` UNIQUE(`post_id`,`channel_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint,
	`type` varchar(60) NOT NULL,
	`subject_type` varchar(40),
	`subject_id` bigint,
	`data` json NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gold_configs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`channel_id` bigint NOT NULL,
	`assets` json NOT NULL DEFAULT ('[]'),
	`frequency` enum('MANUAL','HOURLY','DAILY','WEEKLY') NOT NULL DEFAULT 'MANUAL',
	`time_of_day` varchar(5),
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
	`template` text,
	`is_enabled` boolean NOT NULL DEFAULT false,
	`last_price_snapshot` json,
	`last_sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gold_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_gold_configs_user_channel` UNIQUE(`user_id`,`channel_id`)
);
--> statement-breakpoint
CREATE TABLE `gold_prices` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`asset` enum('GOLD_18K','GOLD_24K','COIN_EMAMI','COIN_HALF','COIN_QUARTER','SILVER','USD','EUR') NOT NULL,
	`price` bigint NOT NULL,
	`source` enum('MANUAL','API') NOT NULL DEFAULT 'MANUAL',
	`recorded_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gold_prices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` varchar(190) NOT NULL,
	`scope` varchar(40) NOT NULL,
	`user_id` bigint,
	`response` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `idempotency_keys_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `link_targets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`post_id` bigint,
	`channel_id` bigint,
	`code` varchar(16) NOT NULL,
	`url` varchar(500) NOT NULL,
	`click_count` bigint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `link_targets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_link_targets_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`stored_path` varchar(255) NOT NULL,
	`mime` varchar(100) NOT NULL,
	`size` bigint NOT NULL,
	`width` int,
	`height` int,
	`sha256` varchar(64) NOT NULL,
	`visibility` enum('PRIVATE','PUBLIC') NOT NULL DEFAULT 'PRIVATE',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`category` enum('SYSTEM','BILLING','PUBLISHING','SECURITY','SUBSCRIPTION') NOT NULL DEFAULT 'SYSTEM',
	`title` varchar(190) NOT NULL,
	`body` text NOT NULL,
	`data` json NOT NULL DEFAULT ('{}'),
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`aggregate_type` varchar(40) NOT NULL,
	`aggregate_id` bigint NOT NULL,
	`event_type` varchar(60) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('PENDING','PROCESSING','DONE','FAILED') NOT NULL DEFAULT 'PENDING',
	`attempts` int NOT NULL DEFAULT 0,
	`available_at` timestamp NOT NULL DEFAULT (now()),
	`processed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_resets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_password_resets_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`purpose` enum('SUBSCRIPTION','WALLET_TOPUP') NOT NULL,
	`plan_id` bigint,
	`subscription_id` bigint,
	`amount` bigint NOT NULL,
	`gateway` enum('ZARINPAL','IDPAY','ZIBAL','MOCK') NOT NULL,
	`authority` varchar(128),
	`gateway_ref` varchar(128),
	`status` enum('CREATED','REDIRECTED','VERIFIED','FAILED','REFUNDED') NOT NULL DEFAULT 'CREATED',
	`meta` json,
	`verified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_payments_authority` UNIQUE(`authority`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`code` enum('FREE','BASIC','PRO','BUSINESS','ORG') NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`price_monthly` bigint NOT NULL DEFAULT 0,
	`limits` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_plans_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`title` varchar(190),
	`body` text NOT NULL,
	`media_id` bigint,
	`status` enum('DRAFT','SCHEDULED','PUBLISHING','PUBLISHED','PARTIAL','FAILED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`published_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`referrer_user_id` bigint NOT NULL,
	`referred_user_id` bigint NOT NULL,
	`code` varchar(16) NOT NULL,
	`status` enum('PENDING','REWARDED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`reward_amount` bigint,
	`rewarded_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_referrals_referred` UNIQUE(`referred_user_id`)
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`post_id` bigint NOT NULL,
	`run_at` timestamp NOT NULL,
	`recurrence` enum('ONCE','DAILY','WEEKLY','MONTHLY') NOT NULL DEFAULT 'ONCE',
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
	`status` enum('ACTIVE','PAUSED','DONE','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
	`last_run_at` timestamp,
	`next_run_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` bigint NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`user_agent` varchar(255),
	`ip` varchar(45),
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sessions_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(60) NOT NULL,
	`value` json NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`plan_id` bigint NOT NULL,
	`status` enum('ACTIVE','EXPIRED','CANCELLED','PENDING_PAYMENT') NOT NULL DEFAULT 'ACTIVE',
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`cancelled_at` timestamp,
	`payment_id` bigint,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`subject` varchar(190) NOT NULL,
	`category` varchar(40) NOT NULL DEFAULT 'GENERAL',
	`status` enum('OPEN','ANSWERED','PENDING_USER','CLOSED') NOT NULL DEFAULT 'OPEN',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `support_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_bootstrap` (
	`id` int NOT NULL,
	`allocated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `system_bootstrap_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_messages` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`ticket_id` bigint NOT NULL,
	`sender_user_id` bigint,
	`is_staff` boolean NOT NULL DEFAULT false,
	`body` text NOT NULL,
	`attachment_id` bigint,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ticket_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`first_name` varchar(100) NOT NULL,
	`last_name` varchar(100) NOT NULL,
	`mobile` varchar(20) NOT NULL,
	`email` varchar(190) NOT NULL,
	`business_name` varchar(190) NOT NULL,
	`business_type` varchar(100) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('SUPER_ADMIN','ADMIN','USER') NOT NULL DEFAULT 'USER',
	`status` enum('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
	`referral_code` varchar(16),
	`referred_by` bigint,
	`accepted_terms` boolean NOT NULL DEFAULT true,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_email` UNIQUE(`email`),
	CONSTRAINT `uq_users_mobile` UNIQUE(`mobile`),
	CONSTRAINT `uq_users_referral_code` UNIQUE(`referral_code`)
);
--> statement-breakpoint
CREATE TABLE `wallet_entries` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`direction` enum('CREDIT','DEBIT') NOT NULL,
	`type` enum('CREDIT','DEBIT','REFUND','BONUS','PAYMENT','ADJUSTMENT') NOT NULL,
	`amount` bigint NOT NULL,
	`balance_after` bigint NOT NULL,
	`reference_type` varchar(40),
	`reference_id` bigint,
	`description` varchar(255),
	`idempotency_key` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wallet_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_wallet_entries_idem` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`balance` bigint NOT NULL DEFAULT 0,
	`currency` varchar(8) NOT NULL DEFAULT 'IRR',
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_wallets_user` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `wordpress_sites` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`site_url` varchar(255) NOT NULL,
	`site_name` varchar(190),
	`secret_encrypted` text NOT NULL,
	`public_id` varchar(32) NOT NULL,
	`status` enum('PENDING','CONNECTED','REVOKED','ERROR') NOT NULL DEFAULT 'PENDING',
	`last_seen_at` timestamp,
	`last_error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wordpress_sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_wp_sites_public_id` UNIQUE(`public_id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`workflow_id` bigint NOT NULL,
	`bot_id` bigint NOT NULL,
	`user_id` bigint NOT NULL,
	`trigger_event_id` bigint,
	`status` enum('RUNNING','COMPLETED','FAILED','TIMEOUT','CANCELLED') NOT NULL DEFAULT 'RUNNING',
	`steps_executed` int NOT NULL DEFAULT 0,
	`ai_calls` int NOT NULL DEFAULT 0,
	`outbound_calls` int NOT NULL DEFAULT 0,
	`error` text,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp,
	CONSTRAINT `workflow_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`bot_id` bigint NOT NULL,
	`name` varchar(190) NOT NULL,
	`definition` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`run_count` bigint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflows_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wp_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`site_id` bigint NOT NULL,
	`type` varchar(60) NOT NULL,
	`external_event_id` varchar(128),
	`signature_valid` boolean NOT NULL DEFAULT false,
	`payload` json NOT NULL,
	`processed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wp_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_wp_events_dedupe` UNIQUE(`site_id`,`external_event_id`)
);
--> statement-breakpoint
CREATE TABLE `wp_products` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`site_id` bigint NOT NULL,
	`user_id` bigint NOT NULL,
	`external_product_id` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`price` bigint,
	`stock` int,
	`permalink` varchar(500),
	`categories` json NOT NULL DEFAULT ('[]'),
	`last_synced_at` timestamp,
	`last_published_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wp_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_wp_products` UNIQUE(`site_id`,`external_product_id`)
);
--> statement-breakpoint
CREATE INDEX `ix_ai_jobs_user` ON `ai_jobs` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_ai_jobs_status` ON `ai_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `ix_audit_logs_action` ON `audit_logs` (`action`,`id`);--> statement-breakpoint
CREATE INDEX `ix_audit_logs_actor` ON `audit_logs` (`actor_user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_bot_events_bot` ON `bot_events` (`bot_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_bot_users_bot` ON `bot_users` (`bot_id`);--> statement-breakpoint
CREATE INDEX `ix_bots_user` ON `bots` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_bots_status` ON `bots` (`status`);--> statement-breakpoint
CREATE INDEX `ix_channels_user_status` ON `channels` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_deliveries_due` ON `deliveries` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `ix_deliveries_user` ON `deliveries` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_events_user_id` ON `events` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_events_type` ON `events` (`type`,`id`);--> statement-breakpoint
CREATE INDEX `ix_gold_prices_user_asset` ON `gold_prices` (`user_id`,`asset`,`id`);--> statement-breakpoint
CREATE INDEX `ix_idempotency_expires` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE INDEX `ix_link_targets_user` ON `link_targets` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_media_user` ON `media` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_notifications_user` ON `notifications` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_outbox_due` ON `outbox_events` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `ix_outbox_aggregate` ON `outbox_events` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE INDEX `ix_password_resets_user` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_payments_user` ON `payments` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_payments_status` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `ix_posts_user_status` ON `posts` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_posts_created` ON `posts` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_referrals_referrer` ON `referrals` (`referrer_user_id`);--> statement-breakpoint
CREATE INDEX `ix_schedules_due` ON `schedules` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `ix_schedules_user` ON `schedules` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `ix_subscriptions_user_status` ON `subscriptions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_subscriptions_expires` ON `subscriptions` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `ix_tickets_user` ON `support_tickets` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_tickets_status` ON `support_tickets` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `ix_ticket_messages_ticket` ON `ticket_messages` (`ticket_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_users_role` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `ix_wallet_entries_user` ON `wallet_entries` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_wp_sites_user` ON `wordpress_sites` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_workflow_runs_workflow` ON `workflow_runs` (`workflow_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_workflow_runs_status` ON `workflow_runs` (`status`);--> statement-breakpoint
CREATE INDEX `ix_workflows_user_bot` ON `workflows` (`user_id`,`bot_id`);--> statement-breakpoint
CREATE INDEX `ix_workflows_active` ON `workflows` (`is_active`);--> statement-breakpoint
CREATE INDEX `ix_wp_events_site` ON `wp_events` (`site_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_wp_products_user` ON `wp_products` (`user_id`);