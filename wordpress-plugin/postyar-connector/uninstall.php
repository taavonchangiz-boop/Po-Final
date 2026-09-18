<?php
/**
 * پاک‌سازی کامل افزونه هنگام حذف — بدون هیچ باقی‌مانده‌ای.
 *
 * حذف می‌شوند:
 *   - جدول گزارش  {$wpdb->prefix}postyar_connector_log
 *   - همهٔ گزینه‌های با پیشوند postyar_connector_ (تنظیمات، کلید مخفی، نسخه‌ها، وضعیت‌ها)
 *   - همهٔ پس‌متاهای محافظ ارسال با پیشوند _postyar_sent_
 *   - رویدادهای زمان‌بندی‌شدهٔ WP-Cron
 *
 * @package Postyar_Connector
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
        exit;
}

global $wpdb;

/* ---------------------------- جدول گزارش ---------------------------- */

$log_table = $wpdb->prefix . 'postyar_connector_log';
// نام جدول فقط از پیشوند قابل‌اعتماد وردپرس ساخته می‌شود.
// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
$wpdb->query( "DROP TABLE IF EXISTS `{$log_table}`" );

/* ------------------------------ گزینه‌ها ------------------------------ */

// حذف دقیق گزینه‌های شناخته‌شده.
$known_options = array(
        'postyar_connector_settings',
        'postyar_connector_secret',
        'postyar_connector_db_version',
        'postyar_connector_version',
        'postyar_connector_last_ping',
        'postyar_connector_last_request',
);

foreach ( $known_options as $option_name ) {
        delete_option( $option_name );
}

// حذف هر گزینهٔ باقی‌مانده با پیشوند افزونه (حافظه/اوتولود وردپرس هم تازه می‌شود).
// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
$wpdb->query(
        $wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
                $wpdb->esc_like( 'postyar_connector_' ) . '%'
        )
);

wp_cache_flush();

/* ---------------------------- پس‌متاها ---------------------------- */

// فلگ‌های محافظ ارسال تکراری روی محصولات.
// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
$wpdb->query(
        $wpdb->prepare(
                "DELETE FROM {$wpdb->postmeta} WHERE meta_key LIKE %s",
                $wpdb->esc_like( '_postyar_sent_' ) . '%'
        )
);

wp_cache_flush();

/* ------------------------------ کوئزها ------------------------------ */

wp_clear_scheduled_hook( 'postyar_connector_heartbeat' );
wp_clear_scheduled_hook( 'postyar_connector_send_event' );
