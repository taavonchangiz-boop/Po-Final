<?php
/**
 * رابط مدیریتی فارسی: کارت وضعیت اتصال، تست اتصال (AJAX) و نمای تشخیصی.
 *
 * امنیت: هر اقدام مدیریتی هم manage_options و هم nonce دارد؛
 * خروجی‌ها با esc_html/esc_attr/esc_url گریز می‌شوند و ورودی‌ها پاک‌سازی می‌شوند.
 *
 * @package Postyar_Connector
 */

if ( ! defined( 'ABSPATH' ) ) {
        exit;
}

/**
 * Class Postyar_Admin
 */
class Postyar_Admin {

        /** نام اکشن AJAX تست اتصال. */
        const AJAX_ACTION = 'postyar_test_connection';

        /**
         * ثبت هوک‌ها.
         *
         * @return void
         */
        public static function init() {
                add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );
                add_action( 'wp_ajax_' . self::AJAX_ACTION, array( __CLASS__, 'ajax_test_connection' ) );
        }

        /**
         * بارگذاری سبک‌ها و اسکریپت‌ها فقط در صفحهٔ افزونه.
         *
         * @param string $hook_suffix پسوند هوک صفحهٔ جاری.
         *
         * @return void
         */
        public static function enqueue_assets( $hook_suffix ) {
                if ( 'settings_page_' . Postyar_Settings::PAGE_SLUG !== $hook_suffix ) {
                        return;
                }

                wp_enqueue_style(
                        'postyar-connector-admin',
                        POSTYAR_CONNECTOR_URL . 'assets/css/admin.css',
                        array(),
                        POSTYAR_CONNECTOR_VERSION
                );

                wp_enqueue_script(
                        'postyar-connector-admin',
                        POSTYAR_CONNECTOR_URL . 'assets/js/admin.js',
                        array(),
                        POSTYAR_CONNECTOR_VERSION,
                        true
                );

                $last_ping = get_option( 'postyar_connector_last_ping', array() );
                $last_ping = is_array( $last_ping ) ? $last_ping : array();

                wp_localize_script(
                        'postyar-connector-admin',
                        'postyarAdmin',
                        array(
                                'ajaxUrl'     => admin_url( 'admin-ajax.php' ),
                                'nonce'       => wp_create_nonce( 'postyar_admin' ),
                                'action'      => self::AJAX_ACTION,
                                'lastPingTs'  => isset( $last_ping['time'] ) ? (int) $last_ping['time'] : 0,
                                'i18n'        => array(
                                        'testing'    => 'در حال بررسی اتصال…',
                                        'ok'         => 'اتصال با پُست‌یار برقرار است.',
                                        'failed'     => 'اتصال با پُست‌یار برقرار نشد.',
                                        'incomplete' => 'ابتدا نشانی پُست‌یار، شناسهٔ سایت و کلید مخفی را ذخیره کنید.',
                                        'noPermission' => 'دسترسی لازم را ندارید.',
                                ),
                        )
                );
        }

        /* ------------------------------ کارت وضعیت ------------------------------ */

        /**
         * کارت وضعیت اتصال (در صفحهٔ تنظیمات نمایش داده می‌شود).
         *
         * @return void
         */
        public static function render_status_card() {
                $paired          = Postyar_Settings::is_paired();
                $api_url_set     = '' !== Postyar_Settings::get_settings()['postyar_api_url'];
                $last_ping       = get_option( 'postyar_connector_last_ping', array() );
                $last_ping       = is_array( $last_ping ) ? $last_ping : array();
                $last_time       = isset( $last_ping['time'] ) ? (int) $last_ping['time'] : 0;
                $last_ok         = ! empty( $last_ping['ok'] );
                $recent          = $last_time > 0 && ( time() - $last_time ) < DAY_IN_SECONDS;

                $state_class = 'postyar-status--idle';
                $state_text  = 'اتصال هنوز آزمایش نشده است.';

                if ( $paired && $api_url_set && $recent && $last_ok ) {
                        $state_class = 'postyar-status--ok';
                        $state_text  = 'اتصال با پُست‌یار برقرار است.';
                } elseif ( $recent && ! $last_ok ) {
                        $state_class = 'postyar-status--error';
                        $state_text  = 'آخرین تلاش اتصال ناموفق بوده است.';
                } elseif ( ! $paired || ! $api_url_set ) {
                        $state_class = 'postyar-status--error';
                        $state_text  = 'اتصال کامل نشده است؛ تنظیمات و کلید مخفی را وارد کنید.';
                }
                ?>
                <h2><?php esc_html_e( 'وضعیت اتصال', 'postyar-connector' ); ?></h2>
                <div class="postyar-card <?php echo esc_attr( $state_class ); ?>" id="postyar-status-card" data-ts="<?php echo esc_attr( (string) $last_time ); ?>">
                        <p class="postyar-status-text"><?php echo esc_html( $state_text ); ?></p>
                        <p class="description">
                                <?php esc_html_e( 'آخرین بررسی:', 'postyar-connector' ); ?>
                                <span class="postyar-jalali" data-ts="<?php echo esc_attr( (string) $last_time ); ?>">
                                        <?php echo esc_html( $last_time > 0 ? '—' : 'هنوز بررسی نشده' ); ?>
                                </span>
                        </p>
                        <p>
                                <button type="button" class="button button-primary" id="postyar-test-connection">
                                        <?php esc_html_e( 'بررسی اتصال', 'postyar-connector' ); ?>
                                </button>
                                <span id="postyar-test-result" class="postyar-test-result" aria-live="polite"></span>
                        </p>
                </div>
                <?php
        }

        /* ------------------------------ AJAX تست ------------------------------ */

        /**
         * AJAX بررسی اتصال: ارسال ping همگام و بازگشت نتیجهٔ فارسی.
         * سطح دسترسی: manage_options + nonce اختصاصی (بدون nopriv).
         *
         * @return void
         */
        public static function ajax_test_connection() {
                check_ajax_referer( 'postyar_admin', 'nonce' );

                if ( ! current_user_can( 'manage_options' ) ) {
                        wp_send_json_error(
                                array( 'message' => 'شما مجاز به انجام این کار نیستید.' ),
                                403
                        );
                }

                $settings = Postyar_Settings::get_settings();

                if ( '' === $settings['postyar_api_url'] || '' === $settings['postyar_site_public_id'] || '' === Postyar_Settings::get_secret() ) {
                        wp_send_json_error(
                                array( 'message' => 'تنظیمات اتصال کامل نیست. نشانی پُست‌یار، شناسهٔ سایت و کلید مخفی را ذخیره کنید.' ),
                                400
                        );
                }

                $result = Postyar_Webhook::send_ping();

                if ( ! empty( $result['ok'] ) ) {
                        wp_send_json_success( $result );
                }

                wp_send_json_error( $result, 502 );
        }

        /* ------------------------------ تشخیص ------------------------------ */

        /**
         * نمای تشخیصی: ۲۰ رویداد آخر جدول گزارش با برچسب فارسی.
         *
         * @return void
         */
        public static function render_diagnostics() {
                $rows = Postyar_DB::recent( 20 );

                $event_labels = array(
                        'ping'              => 'ضربان / تست اتصال',
                        'product.published' => 'انتشار محصول',
                        'product.updated'   => 'به‌روزرسانی محصول',
                        'product.deleted'   => 'حذف محصول',
                );

                $status_labels = array(
                        'queued' => 'در صف ارسال',
                        'ok'     => 'موفق',
                        'failed' => 'ناموفق',
                );
                ?>
                <h2><?php esc_html_e( 'رویدادهای اخیر', 'postyar-connector' ); ?></h2>
                <p class="description"><?php esc_html_e( '۲۰ رویداد آخر (ضربان، انتشار و به‌روزرسانی محصولات) با نتیجهٔ ارسال.', 'postyar-connector' ); ?></p>

                <?php if ( empty( $rows ) ) : ?>
                        <p><?php esc_html_e( 'هنوز رویدادی ثبت نشده است.', 'postyar-connector' ); ?></p>
                        <?php return; ?>
                <?php endif; ?>

                <table class="widefat striped postyar-log-table">
                        <thead>
                                <tr>
                                        <th scope="col"><?php esc_html_e( 'رویداد', 'postyar-connector' ); ?></th>
                                        <th scope="col"><?php esc_html_e( 'شناسهٔ رویداد', 'postyar-connector' ); ?></th>
                                        <th scope="col"><?php esc_html_e( 'وضعیت', 'postyar-connector' ); ?></th>
                                        <th scope="col"><?php esc_html_e( 'کد پاسخ', 'postyar-connector' ); ?></th>
                                        <th scope="col"><?php esc_html_e( 'زمان', 'postyar-connector' ); ?></th>
                                </tr>
                        </thead>
                        <tbody>
                                <?php foreach ( $rows as $row ) :
                                        $ts = strtotime( (string) $row['created_at'] . ' +0000' );
                                        $ts = false === $ts ? 0 : (int) $ts;
                                        ?>
                                        <tr>
                                                <td><?php echo esc_html( isset( $event_labels[ $row['event_type'] ] ) ? $event_labels[ $row['event_type'] ] : $row['event_type'] ); ?></td>
                                                <td><code class="ltr"><?php echo esc_html( mb_substr( (string) $row['event_id'], 0, 18 ) ); ?>…</code></td>
                                                <td><?php echo esc_html( isset( $status_labels[ $row['status'] ] ) ? $status_labels[ $row['status'] ] : $row['status'] ); ?></td>
                                                <td><?php echo esc_html( ( null === $row['response_code'] || '' === $row['response_code'] ) ? '—' : (string) $row['response_code'] ); ?></td>
                                                <td><span class="postyar-jalali" data-ts="<?php echo esc_attr( (string) $ts ); ?>"><?php echo esc_html( (string) $row['created_at'] ); ?></span></td>
                                        </tr>
                                <?php endforeach; ?>
                        </tbody>
                </table>
                <?php
        }
}
