<?php
/**
 * ارسال رویدادهای محصول به وب‌هوک پُستیار (جهت افزونه → سرویس).
 *
 * رویدادها:
 *   product.published  هنگام انتشار محصول (transition_post_status → publish)
 *   product.updated    هنگام به‌روزرسانی محصول منتشرشده (woocommerce_update_product)
 *   product.deleted    هنگام حذف/زباله‌دان محصول
 *   ping               تست اتصال + ضربان روزانه
 *
 * محافظت از ارسال تکراری: فلگ پس‌متا «_postyar_sent_{event}» + نگاشت استاتیک درون‌درخواستی؛
 * هوک فعال با current_filter() ثبت می‌شود تا هر رویداد فقط یک‌بار ساخته شود.
 *
 * ارسال همیشه غیرهمگام است (WP-Cron single event با تأخیر ۱۰ ثانیه) تا نخ درخواست
 * مسدود نشود؛ فقط «تست اتصال» و ضربان روزانه همگام‌اند.
 * تلاش مجدد: ۳ تلاش با تأخیر نمایی ۱۰ و ۶۰ ثانیه؛ هر تلاش در جدول گزارش ثبت می‌شود.
 *
 * کلید مخفی هرگز در گزارش/لاگ نوشته نمی‌شود.
 *
 * @package Postyar_Connector
 */

if ( ! defined( 'ABSPATH' ) ) {
        exit;
}

/**
 * Class Postyar_Webhook
 */
class Postyar_Webhook {

        /** حداکثر تلاش ارسال برای هر رویداد. */
        const MAX_ATTEMPTS = 3;

        /** مهلت هر درخواست ارسال (ثانیه). */
        const REQUEST_TIMEOUT = 5;

        /** حداقل فاصلهٔ دو ارسال «به‌روزرسانی/حذف» برای یک محصول (ثانیه). */
        const EVENT_THROTTLE = 30;

        /**
         * رویدادهای علامت‌خوردهٔ همین درخواست: کلید «event:product_id» ⇒ نام هوک.
         *
         * @var array<string, string>
         */
        private static $marked = array();

        /**
         * ثبت هوک‌های ووکامرس.
         *
         * @return void
         */
        public static function init() {
                add_action( 'transition_post_status', array( __CLASS__, 'on_transition_post_status' ), 10, 3 );
                add_action( 'woocommerce_new_product', array( __CLASS__, 'on_new_product' ), 10, 1 );
                add_action( 'woocommerce_update_product', array( __CLASS__, 'on_update_product' ), 10, 1 );
                add_action( 'woocommerce_delete_product', array( __CLASS__, 'on_delete_product' ), 10, 1 );
        }

        /* ----------------------------- هوک‌های منبع ----------------------------- */

        /**
         * انتشار / زباله‌دان شدن محصول از مسیر وضعیت نوشته.
         *
         * @param string  $new_status وضعیت جدید.
         * @param string  $old_status وضعیت قبلی.
         * @param WP_Post $post       نوشته.
         *
         * @return void
         */
        public static function on_transition_post_status( $new_status, $old_status, $post ) {
                if ( ! $post instanceof WP_Post || 'product' !== $post->post_type ) {
                        return;
                }

                if ( 'publish' === $new_status ) {
                        // ساخت تازه با وضعیت انتشار (old=new) یا گذار پیش‌نویس→انتشار؛ هر دو یک رویداد.
                        self::maybe_queue( 'product.published', (int) $post->ID );
                        return;
                }

                if ( 'publish' === $old_status && in_array( $new_status, array( 'trash', 'draft', 'pending', 'private' ), true ) ) {
                        self::maybe_queue( 'product.deleted', (int) $post->ID );
                }
        }

        /**
         * هوک ساخت محصول — محافظ تکرار در برابر رویداد update بلافاصله پس از ساخت.
         * رویداد «انتشار» توسط transition_post_status ساخته می‌شود (در wp_insert_post
         * گذار وضعیت پیش از save_post انجام می‌شود).
         *
         * @param int $product_id شناسهٔ محصول.
         *
         * @return void
         */
        public static function on_new_product( $product_id ) {
                self::mark_request( 'product.created', (int) $product_id );
        }

        /**
         * هوک به‌روزرسانی محصول.
         *
         * @param int $product_id شناسهٔ محصول.
         *
         * @return void
         */
        public static function on_update_product( $product_id ) {
                $product_id = (int) $product_id;

                if ( 'product' !== get_post_type( $product_id ) || 'publish' !== get_post_status( $product_id ) ) {
                        return;
                }

                // ساخت تازه یا ارسال «انتشار» در همین درخواست؟ پس «به‌روزرسانی» نفرست.
                if ( self::was_marked_in_request( 'product.published', $product_id )
                        || self::was_marked_in_request( 'product.created', $product_id ) ) {
                        return;
                }

                self::maybe_queue( 'product.updated', $product_id );
        }

        /**
         * هوک حذف کامل محصول.
         *
         * @param int $product_id شناسهٔ محصول.
         *
         * @return void
         */
        public static function on_delete_product( $product_id ) {
                self::maybe_queue( 'product.deleted', (int) $product_id, true );
        }

        /* --------------------------- صف‌گذاری رویداد --------------------------- */

        /**
         * ساخت بار رویداد، ثبت در گزارش به‌عنوان «queued» و زمان‌بندی ارسال غیرهمگام.
         *
         * @param string $event_type  نوع رویداد.
         * @param int    $product_id  شناسهٔ محصول.
         * @param bool   $is_deletion محصول حذف شده است (بار حداقلی).
         *
         * @return void
         */
        private static function maybe_queue( $event_type, $product_id, $is_deletion = false ) {
                $settings = Postyar_Settings::get_settings();

                // بدون جفت‌سازی کامل، رویدادی ارسال نمی‌شود.
                if ( ! Postyar_Settings::is_paired() || '' === $settings['postyar_api_url'] ) {
                        return;
                }

                if ( ! self::once_only( $event_type, $product_id ) ) {
                        return;
                }

                $payload = self::build_payload( $event_type, $product_id, $is_deletion );
                if ( null === $payload ) {
                        return;
                }

                self::queue( $event_type, $payload );
        }

        /**
         * محافظ ارسال تکراری: فلگ پس‌متا + نگاشت درون‌درخواستی.
         * هوک فعال با current_filter() ثبت می‌شود (مطابق قرارداد افزونه).
         *
         * @param string $event_type نوع رویداد.
         * @param int    $product_id شناسهٔ محصول.
         *
         * @return bool اجازهٔ ارسال دارد؟
         */
        private static function once_only( $event_type, $product_id ) {
                if ( self::was_marked_in_request( $event_type, $product_id ) ) {
                        return false;
                }

                $meta_key = '_postyar_sent_' . str_replace( 'product.', '', $event_type );

                // محدودسازی نرخ رویدادهای تکراری یک محصول در درخواست‌های پیاپی.
                $last = (int) get_post_meta( $product_id, $meta_key, true );
                if ( $last > 0 && ( time() - $last ) < self::EVENT_THROTTLE ) {
                        self::mark_request( $event_type, $product_id );
                        return false;
                }

                self::mark_request( $event_type, $product_id );
                update_post_meta( $product_id, $meta_key, time() );

                return true;
        }

        /**
         * آیا این رویداد در همین درخواست قبلاً علامت خورده است؟
         *
         * @param string $event_type نوع رویداد.
         * @param int    $product_id شناسهٔ محصول.
         *
         * @return bool
         */
        private static function was_marked_in_request( $event_type, $product_id ) {
                $key = $event_type . ':' . $product_id;

                return isset( self::$marked[ $key ] );
        }

        /**
         * علامت‌گذاری رویداد در نگاشت درون‌درخواستی؛ منبع هوک فعلی ثبت می‌شود.
         *
         * @param string $event_type نوع رویداد.
         * @param int    $product_id شناسهٔ محصول.
         *
         * @return void
         */
        private static function mark_request( $event_type, $product_id ) {
                $key                    = $event_type . ':' . $product_id;
                self::$marked[ $key ] = current_filter();
        }

        /* -------------------------------- بارها -------------------------------- */

        /**
         * ساخت بار رویداد مطابق قرارداد.
         *
         * @param string $event_type  نوع رویداد.
         * @param int    $product_id  شناسهٔ محصول.
         * @param bool   $is_deletion حذف؟
         *
         * @return array<string, mixed>|null
         */
        private static function build_payload( $event_type, $product_id, $is_deletion ) {
                $product_payload = array( 'id' => $product_id );

                if ( ! $is_deletion ) {
                        $serialized = self::build_product_payload( $product_id );
                        if ( null === $serialized ) {
                                return null;
                        }
                        $product_payload = $serialized;
                } else {
                        // پس از حذف، شناسه (و اگر در دسترس باشد، نام پیشین) کافی است.
                        $title = get_the_title( $product_id );
                        if ( is_string( $title ) && '' !== $title ) {
                                $product_payload['title'] = mb_substr( $title, 0, 255 );
                        }
                }

                return array(
                        'product' => $product_payload,
                        'site'    => home_url(),
                );
        }

        /**
         * ساخت بار محصول (برای صف‌گذاری؛ ووکامرس باید فعال باشد).
         *
         * @param int $product_id شناسهٔ محصول.
         *
         * @return array<string, mixed>|null
         */
        public static function build_product_payload( $product_id ) {
                if ( ! function_exists( 'wc_get_product' ) ) {
                        return null;
                }

                $product = wc_get_product( $product_id );
                if ( ! $product instanceof WC_Product ) {
                        return null;
                }

                $price = $product->get_price();
                $price = ( '' === $price || null === $price ) ? null : (float) $price;

                $stock = $product->get_stock_quantity();

                $categories = array();
                $terms      = wp_get_post_terms( $product_id, 'product_cat', array( 'fields' => 'names' ) );
                if ( is_array( $terms ) ) {
                        foreach ( $terms as $term ) {
                                if ( is_string( $term ) && '' !== $term ) {
                                        $categories[] = mb_substr( $term, 0, 100 );
                                }
                                if ( count( $categories ) >= 20 ) {
                                        break;
                                }
                        }
                }

                $permalink = get_permalink( $product_id );
                $permalink = is_string( $permalink ) ? esc_url_raw( $permalink ) : null;

                $title = (string) $product->get_name();
                if ( '' === $title ) {
                        // قرارداد سرور نام خالی را نمی‌پذیرد.
                        $title = 'محصول ' . absint( $product_id );
                }

                return array(
                        'id'         => absint( $product_id ),
                        'title'      => mb_substr( $title, 0, 255 ),
                        'price'      => $price,
                        'stock'      => ( null === $stock ) ? null : (int) $stock,
                        'permalink'  => $permalink,
                        'categories' => $categories,
                );
        }

        /* ---------------------------- صف و ارسال ---------------------------- */

        /**
         * زمان‌بندی ارسال غیرهمگام (WP-Cron single event، ۱۰ ثانیه بعد).
         *
         * @param string               $event_type نوع رویداد.
         * @param array<string, mixed> $payload    بار رویداد.
         * @param int                  $attempts   شمارهٔ تلاش (۱ شروع می‌شود).
         *
         * @return string شناسهٔ رویداد.
         */
        public static function queue( $event_type, $payload, $attempts = 1 ) {
                $event_id = wp_generate_uuid4();

                Postyar_DB::log( $event_type, $event_id, Postyar_DB::STATUS_QUEUED, null );

                $args = array(
                        'event_type' => $event_type,
                        'event_id'   => $event_id,
                        'payload'    => $payload,
                        'attempts'   => max( 1, (int) $attempts ),
                );

                $scheduled = wp_schedule_single_event( time() + 10, 'postyar_connector_send_event', array( $args ) );

                if ( is_wp_error( $scheduled ) ) {
                        // زمان‌بندی ناموفق بود؛ مسیر پشتیبان: همان لحظه و همگام.
                        self::deliver( $event_type, $event_id, $payload );
                }

                return $event_id;
        }

        /**
         * فراخوانی کوئز: ارسال یک رویداد زمان‌بندی‌شده.
         *
         * @param array<string, mixed> $args آرگومان‌های صف‌شده.
         *
         * @return void
         */
        public static function cron_send( $args ) {
                if ( ! is_array( $args ) || empty( $args['event_type'] ) || empty( $args['event_id'] ) ) {
                        return;
                }

                $event_type = (string) $args['event_type'];
                $event_id   = (string) $args['event_id'];
                $payload    = is_array( isset( $args['payload'] ) ? $args['payload'] : null ) ? $args['payload'] : array();
                $attempts   = isset( $args['attempts'] ) ? (int) $args['attempts'] : 1;

                $ok = self::deliver( $event_type, $event_id, $payload );

                if ( ! $ok && $attempts < self::MAX_ATTEMPTS ) {
                        // تلاش مجدد نمایی: تلاش ۲ پس از ۱۰ ثانیه، تلاش ۳ پس از ۶۰ ثانیه.
                        $delays           = array( 1 => 10, 2 => 60 );
                        $delay             = isset( $delays[ $attempts ] ) ? $delays[ $attempts ] : 60;
                        $args['attempts'] = $attempts + 1;

                        wp_schedule_single_event( time() + $delay, 'postyar_connector_send_event', array( $args ) );
                }
        }

        /**
         * ارسال واقعی رویداد به وب‌هوک پُستیار + ثبت گزارش.
         *
         * @param string               $event_type نوع رویداد.
         * @param string               $event_id   شناسهٔ رویداد.
         * @param array<string, mixed> $payload    بار رویداد.
         *
         * @return bool موفق بود؟
         */
        private static function deliver( $event_type, $event_id, $payload ) {
                $settings = Postyar_Settings::get_settings();
                $secret   = Postyar_Settings::get_secret();

                if ( '' === $settings['postyar_api_url'] || '' === $settings['postyar_site_public_id'] || '' === $secret ) {
                        return false;
                }

                $endpoint = self::webhook_url( $settings['postyar_api_url'], $settings['postyar_site_public_id'] );
                if ( null === $endpoint ) {
                        return false;
                }

                $body = (string) wp_json_encode(
                        array(
                                'type'     => $event_type,
                                'event_id' => $event_id,
                                'site'     => $settings['postyar_site_public_id'],
                                'payload'  => $payload,
                                'sent_at'  => gmdate( 'c' ),
                        )
                );

                $timestamp = (string) time();

                $headers = array(
                        'Content-Type'         => 'application/json; charset=utf-8',
                        'User-Agent'           => 'Postyar-Connector/' . POSTYAR_CONNECTOR_VERSION . '; ' . home_url(),
                        'X-Postyar-Site'       => $settings['postyar_site_public_id'],
                        'X-Postyar-Timestamp'  => $timestamp,
                        'X-Postyar-Signature'  => Postyar_Signature::header( $secret, $timestamp, $body ),
                        'X-Postyar-Event-Id'   => $event_id,
                        'X-Postyar-Event-Type' => $event_type,
                );

                $response = wp_remote_post(
                        $endpoint,
                        array(
                                'timeout'     => self::REQUEST_TIMEOUT,
                                'blocking'    => true,
                                'sslverify'   => true,
                                'data_format' => 'body',
                                'body'        => $body,
                                'headers'     => $headers,
                        )
                );

                $code = is_array( $response ) ? (int) wp_remote_retrieve_response_code( $response ) : 0;

                // سازگاری: نسخهٔ فعلی سرور امضای «فقط بدنه» را می‌پذیرد؛ در ۴۰۱ یک‌بار با آن طرح تلاش می‌کنیم.
                if ( 401 === $code ) {
                        $headers['X-Postyar-Signature'] = 'sha256=' . Postyar_Signature::sign_body_only( $secret, $body );

                        $response = wp_remote_post(
                                $endpoint,
                                array(
                                        'timeout'     => self::REQUEST_TIMEOUT,
                                        'blocking'    => true,
                                        'sslverify'   => true,
                                        'data_format' => 'body',
                                        'body'        => $body,
                                        'headers'     => $headers,
                                )
                        );
                        $code = is_array( $response ) ? (int) wp_remote_retrieve_response_code( $response ) : 0;
                }

                $ok = $code >= 200 && $code < 300;

                Postyar_DB::log( $event_type, $event_id, $ok ? Postyar_DB::STATUS_OK : Postyar_DB::STATUS_FAILED, $code );

                return $ok;
        }

        /**
         * ساخت نشانی وب‌هوک فقط از تنظیمات ذخیره‌شده + محافظ SSRF
         * (طرح http/https و میزبان غیرخالی الزامی است؛ هیچ ورودی درخواستی دخیل نیست).
         *
         * @param string $api_url   نشانی پایهٔ پُستیار (تنظیمات مدیر).
         * @param string $public_id شناسهٔ عمومی سایت (تنظیمات مدیر).
         *
         * @return string|null
         */
        public static function webhook_url( $api_url, $public_id ) {
                $api_url = untrailingslashit( trim( (string) $api_url ) );

                if ( '' === $api_url ) {
                        return null;
                }

                $parts = wp_parse_url( $api_url );

                if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
                        return null;
                }

                $scheme = isset( $parts['scheme'] ) ? strtolower( (string) $parts['scheme'] ) : '';
                if ( ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
                        return null;
                }

                return untrailingslashit( esc_url_raw( $api_url ) ) . '/api/v1/webhooks/wordpress/' . rawurlencode( (string) $public_id );
        }

        /* ------------------------------ ضربان ------------------------------ */

        /**
         * ضربان روزانه: هرس گزارش + ارسال ping در صورت جفت‌ بودن.
         *
         * @return void
         */
        public static function send_heartbeat() {
                Postyar_DB::prune();

                if ( ! Postyar_Settings::is_paired() ) {
                        return;
                }

                self::send_ping();
        }

        /**
         * ارسال همگام ping (برای تست اتصال مدیر و ضربان روزانه).
         *
         * @return array{ok: bool, code: int, message: string}
         */
        public static function send_ping() {
                $settings = Postyar_Settings::get_settings();

                if ( ! Postyar_Settings::is_paired() || '' === $settings['postyar_api_url'] ) {
                        return array(
                                'ok'      => false,
                                'code'    => 0,
                                'message' => 'تنظیمات اتصال کامل نیست. نشانی پُستیار، شناسهٔ سایت و کلید مخفی را وارد کنید.',
                        );
                }

                $event_id = wp_generate_uuid4();

                $payload = array(
                        'wp_version'     => get_bloginfo( 'version' ),
                        'wc_active'      => class_exists( 'WooCommerce' ),
                        'plugin_version' => POSTYAR_CONNECTOR_VERSION,
                );

                $ok   = self::deliver( 'ping', $event_id, $payload );
                $code = $ok ? 200 : 0;

                $result = array(
                        'ok'      => $ok,
                        'code'    => $code,
                        'message' => $ok
                                ? 'اتصال با پُستیار برقرار است.'
                                : 'اتصال با پُستیار برقرار نشد. تنظیمات و دسترسی شبکه را بررسی کنید.',
                );

                update_option(
                        'postyar_connector_last_ping',
                        array(
                                'time'    => time(),
                                'ok'      => $ok,
                                'code'    => $code,
                                'message' => $result['message'],
                        ),
                        false
                );

                return $result;
        }
}
