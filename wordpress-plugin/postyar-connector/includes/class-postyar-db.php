<?php
/**
 * مدیریت جدول گزارش رویدادها و نسخهٔ دیتابیس افزونه.
 *
 * جدول: {$wpdb->prefix}postyar_connector_log
 *   id BIGINT UNSIGNED PK AI | event_type VARCHAR(60) | event_id VARCHAR(64)
 *   status VARCHAR(20) | response_code INT NULL | created_at DATETIME | INDEX(created_at)
 *
 * هیچ مقدار محرمانه‌ای (از جمله کلید مخفی) در این جدول ذخیره نمی‌شود.
 *
 * @package Postyar_Connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Postyar_DB
 */
class Postyar_DB {

	/** برچسب وضعیت موفق. */
	const STATUS_OK = 'ok';

	/** برچسب وضعیت ناموفق. */
	const STATUS_FAILED = 'failed';

	/** برچسب وضعیت در صف. */
	const STATUS_QUEUED = 'queued';

	/**
	 * ساخت جدول با dbDelta (مسیر امن ارتقا).
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			event_type VARCHAR(60) NOT NULL DEFAULT '',
			event_id VARCHAR(64) NOT NULL DEFAULT '',
			status VARCHAR(20) NOT NULL DEFAULT '',
			response_code INT(11) NULL DEFAULT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY created_at (created_at),
			KEY event_id (event_id)
		) {$collate};";

		dbDelta( $sql );

		update_option( 'postyar_connector_db_version', POSTYAR_CONNECTOR_DB_VERSION, false );
	}

	/**
	 * ارتقای خودکار پس از به‌روزرسانی افزونه (خودترمیمی؛ بدون DDL در مسیر درخواست عمومی).
	 *
	 * @return void
	 */
	public static function maybe_upgrade() {
		$installed = get_option( 'postyar_connector_db_version' );

		if ( POSTYAR_CONNECTOR_DB_VERSION !== $installed ) {
			self::install();
		}
	}

	/**
	 * نام کامل جدول با prepare-safe prefix.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;

		return $wpdb->prefix . 'postyar_connector_log';
	}

	/**
	 * درج یک ردیف گزارش. ورودی‌ها بریده و پاک‌سازی می‌شوند؛ هرگز کلید مخفی وارد نمی‌شود.
	 *
	 * @param string   $event_type    نوع رویداد (مثلاً product.published).
	 * @param string   $event_id      شناسهٔ یکتای رویداد (UUID).
	 * @param string   $status        ok | failed | queued.
	 * @param int|null $response_code کد پاسخ HTTP در صورت وجود.
	 *
	 * @return bool
	 */
	public static function log( $event_type, $event_id, $status, $response_code = null ) {
		global $wpdb;

		if ( ! self::table_exists() ) {
			return false;
		}

		$inserted = $wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			self::table(),
			array(
				'event_type'    => mb_substr( sanitize_text_field( (string) $event_type ), 0, 60 ),
				'event_id'      => mb_substr( sanitize_text_field( (string) $event_id ), 0, 64 ),
				'status'        => mb_substr( sanitize_text_field( (string) $status ), 0, 20 ),
				'response_code' => ( null === $response_code ) ? null : absint( $response_code ),
				'created_at'    => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%s', is_null( $response_code ) ? '%s' : '%d', '%s' )
		);

		return false !== $inserted;
	}

	/**
	 * آخرین ردیف‌های گزارش برای نما تشخیصی.
	 *
	 * @param int $limit حداکثر تعداد (بین ۱ تا ۵۰).
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public static function recent( $limit = 20 ) {
		global $wpdb;

		$limit = max( 1, min( 50, absint( $limit ) ) );

		if ( ! self::table_exists() ) {
			return array();
		}

		$table = self::table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, event_type, event_id, status, response_code, created_at
				 FROM {$table}
				 ORDER BY id DESC
				 LIMIT %d",
				$limit
			),
			ARRAY_A
		);

		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * هرس ردیف‌های قدیمی‌تر از ۳۰ روز (در ضربان روزانه فراخوانی می‌شود).
	 *
	 * @return void
	 */
	public static function prune() {
		global $wpdb;

		if ( ! self::table_exists() ) {
			return;
		}

		$table = self::table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE created_at < %s",
				gmdate( 'Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS )
			)
		);
	}

	/**
	 * بررسی وجود جدول (کش‌شده در هر درخواست).
	 *
	 * @return bool
	 */
	public static function table_exists() {
		global $wpdb;

		static $exists = null;

		if ( null !== $exists ) {
			return $exists;
		}

		$table  = self::table();
		$like   = $wpdb->esc_like( $table );
		$exists = (bool) $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare( 'SHOW TABLES LIKE %s', $like )
		);

		return $exists;
	}
}
