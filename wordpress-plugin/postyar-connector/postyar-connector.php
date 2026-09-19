<?php
/**
 * Plugin Name:       Postyar Connector | پُست‌یار کانکتور
 * Plugin URI:        https://postyar.ir
 * Description:       اتصال فروشگاه ووکامرس شما به سکوی پُست‌یار؛ همگام‌سازی محصولات و اطلاع‌رسانی رویدادها با امضای HMAC امن، بدون ارسال کلید مخفی.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Postyar | پُست‌یار
 * Author URI:        https://postyar.ir
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       postyar-connector
 * Domain Path:       /languages
 *
 * @package Postyar_Connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // دسترسی مستقیم ممنوع است.
}

define( 'POSTYAR_CONNECTOR_VERSION', '1.0.0' );
define( 'POSTYAR_CONNECTOR_DB_VERSION', '1.0.0' );
define( 'POSTYAR_CONNECTOR_FILE', __FILE__ );
define( 'POSTYAR_CONNECTOR_DIR', plugin_dir_path( __FILE__ ) );
define( 'POSTYAR_CONNECTOR_URL', plugin_dir_url( __FILE__ ) );

/*
 * هوک‌های REST و کوئزی که این افزونه ثبت می‌کند:
 *  - REST namespace:  postyar-connector/v1  (routes: /products, /ping)
 *  - WP-Cron hooks:   postyar_connector_heartbeat (رویداد روزانه), postyar_connector_send_event (ارسال تکی غیرهمگام)
 *  - admin-ajax:      postyar_test_connection (فقط مدیر، با نانس)
 */

require_once POSTYAR_CONNECTOR_DIR . 'includes/class-postyar-signature.php';
require_once POSTYAR_CONNECTOR_DIR . 'includes/class-postyar-db.php';
require_once POSTYAR_CONNECTOR_DIR . 'includes/class-postyar-rest.php';
require_once POSTYAR_CONNECTOR_DIR . 'includes/class-postyar-webhook.php';
require_once POSTYAR_CONNECTOR_DIR . 'includes/class-postyar-settings.php';
require_once POSTYAR_CONNECTOR_DIR . 'includes/class-postyar-admin.php';

register_activation_hook( __FILE__, array( 'Postyar_Connector', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Postyar_Connector', 'deactivate' ) );

/**
 * راه‌انداز اصلی افزونه.
 */
final class Postyar_Connector {

	/**
	 * فعال‌سازی: ایجاد جدول گزارش، زمان‌بندی ضربان روزانه و ثبت نسخه دیتابیس.
	 *
	 * @return void
	 */
	public static function activate() {
		Postyar_DB::install();

		if ( ! wp_next_scheduled( 'postyar_connector_heartbeat' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'postyar_connector_heartbeat' );
		}

		update_option( 'postyar_connector_db_version', POSTYAR_CONNECTOR_DB_VERSION, false );
		update_option( 'postyar_connector_version', POSTYAR_CONNECTOR_VERSION, false );
	}

	/**
	 * غیرفعال‌سازی: پاک‌سازی تمام زمان‌بندی‌های کوئز (جدول و گزینه‌ها حفظ می‌شوند).
	 *
	 * @return void
	 */
	public static function deactivate() {
		wp_clear_scheduled_hook( 'postyar_connector_heartbeat' );
		wp_clear_scheduled_hook( 'postyar_connector_send_event' );
	}

	/**
	 * بارگذاری ماژول‌ها و ثبت هوک‌های عمومی.
	 *
	 * @return void
	 */
	public static function init() {
		load_plugin_textdomain(
			'postyar-connector',
			false,
			dirname( plugin_basename( POSTYAR_CONNECTOR_FILE ) ) . '/languages'
		);

		// ارتقای امن ساختار دیتابیس پس از به‌روزرسانی افزونه.
		add_action( 'admin_init', array( 'Postyar_DB', 'maybe_upgrade' ) );

		add_action( 'rest_api_init', array( 'Postyar_REST', 'register_routes' ) );

		add_action( 'postyar_connector_heartbeat', array( 'Postyar_Webhook', 'send_heartbeat' ) );
		add_action( 'postyar_connector_send_event', array( 'Postyar_Webhook', 'cron_send' ), 10, 1 );

		Postyar_Webhook::init();
		Postyar_Settings::init();
		Postyar_Admin::init();
	}
}

add_action( 'plugins_loaded', array( 'Postyar_Connector', 'init' ) );
