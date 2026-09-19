<?php
/**
 * مسیرهای REST افزونه — namespace: postyar-connector/v1
 *
 *  GET /products  : همگام‌سازی کششی محصولات ووکامرس (پُست‌یار ← سایت).
 *  GET /ping      : اطمینان‌سنجی اتصال و نسخه‌ها.
 *
 * احراز هویت فقط با امضای HMAC (بدون کوکی، بدون nonce):
 *   X-Postyar-Site      : شناسهٔ عمومی سایت
 *   X-Postyar-Timestamp : ثانیه‌های یونیکس (±۳۰۰ ثانیه)
 *   X-Postyar-Signature : sha256=<hmac(secret, timestamp + "\n" + body)>  (GET ⇒ بدنهٔ خالی)
 *
 * درخواست‌ها با سقف نرخ محدود می‌شوند؛ بدون ووکامرس ⇒ ۵۰۳ با پیام فارسی.
 *
 * @package Postyar_Connector
 */

if ( ! defined( 'ABSPATH' ) ) {
        exit;
}

/**
 * Class Postyar_REST
 */
class Postyar_REST {

        /** حداکثر per_page مجاز (قرارداد: ۵۰). */
        const MAX_PER_PAGE = 50;

        /** سقف درخواست‌ها در هر ۱۰ دقیقه برای هر سایت+آی‌پی. */
        const RATE_LIMIT = 60;

        /**
         * ثبت مسیرها.
         *
         * @return void
         */
        public static function register_routes() {
                register_rest_route(
                        'postyar-connector/v1',
                        '/products',
                        array(
                                'methods'             => WP_REST_Server::READABLE,
                                'callback'            => array( __CLASS__, 'get_products' ),
                                'permission_callback' => array( __CLASS__, 'check_request_signature' ),
                                'args'                => array(
                                        'per_page' => array(
                                                'type'              => 'integer',
                                                'required'          => false,
                                                'default'           => self::MAX_PER_PAGE,
                                                'minimum'           => 1,
                                                'sanitize_callback' => array( __CLASS__, 'clamp_per_page' ),
                                        ),
                                        'page'     => array(
                                                'type'              => 'integer',
                                                'required'          => false,
                                                'default'           => 1,
                                                'minimum'           => 1,
                                                'sanitize_callback' => 'absint',
                                        ),
                                ),
                        )
                );

                register_rest_route(
                        'postyar-connector/v1',
                        '/ping',
                        array(
                                'methods'             => WP_REST_Server::READABLE,
                                'callback'            => array( __CLASS__, 'get_ping' ),
                                'permission_callback' => array( __CLASS__, 'check_request_signature' ),
                                'args'                => array(),
                        )
                );
        }

        /**
         * محدودسازی per_page به بازهٔ [۱، ۵۰].
         *
         * @param mixed $param مقدار ورودی.
         *
         * @return int
         */
        public static function clamp_per_page( $param ) {
                return max( 1, min( self::MAX_PER_PAGE, absint( $param ) ) );
        }

        /* ------------------------------ احراز هویت ------------------------------ */

        /**
         * خواندن امن یک هدر درخواست.
         *
         * @param string $name نام هدر (بدون پیشوند HTTP_).
         *
         * @return string
         */
        private static function get_header( $name ) {
                $key = 'HTTP_' . strtoupper( str_replace( '-', '_', $name ) );

                return isset( $_SERVER[ $key ] ) ? sanitize_text_field( wp_unslash( (string) $_SERVER[ $key ] ) ) : '';
        }

        /**
         * بررسی امضا + مهر زمان + شناسهٔ سایت + سقف نرخ.
         * فقط امضا؛ هیچ کوکی یا nonce در این مسیر بررسی نمی‌شود.
         *
         * @param WP_REST_Request $request درخواست.
         *
         * @return true|WP_Error
         */
        public static function check_request_signature( $request ) {
                $settings = Postyar_Settings::get_settings();
                $secret   = Postyar_Settings::get_secret();

                if ( '' === $settings['postyar_site_public_id'] || '' === $secret ) {
                        return new WP_Error(
                                'postyar_not_paired',
                                'افزونه هنوز با پُست‌یار جفت‌سازی نشده است.',
                                array( 'status' => 503 )
                        );
                }

                $site_id      = self::get_header( 'X-Postyar-Site' );
                $timestamp    = self::get_header( 'X-Postyar-Timestamp' );
                $signature    = self::get_header( 'X-Postyar-Signature' );

                if ( ! hash_equals( $settings['postyar_site_public_id'], $site_id ) ) {
                        return new WP_Error(
                                'postyar_site_mismatch',
                                'امضای درخواست معتبر نیست.',
                                array( 'status' => 401 )
                        );
                }

                if ( ! self::rate_limit_ok( $site_id ) ) {
                        return new WP_Error(
                                'postyar_rate_limited',
                                'تعداد درخواست‌ها بیش از حد مجاز است. بعداً تلاش کنید.',
                                array( 'status' => 429 )
                        );
                }

                // GET بدون بدنه ⇒ preimage شامل رشتهٔ خالی است.
                if ( ! Postyar_Signature::verify( $secret, $timestamp, '', $signature ) ) {
                        return new WP_Error(
                                'postyar_bad_signature',
                                'امضای درخواست معتبر نیست.',
                                array( 'status' => 401 )
                        );
                }

                // آخرین تماس موفق سرویس (برای کارت وضعیت داشبورد).
                update_option(
                        'postyar_connector_last_request',
                        array(
                                'time'  => time(),
                                'route' => $request->get_route(),
                        ),
                        false
                );

                return true;
        }

        /**
         * سقف نرخ ساده مبتنی بر transient (بدون فایل یا جدول اضافه).
         *
         * @param string $site_id شناسهٔ عمومی سایت.
         *
         * @return bool
         */
        private static function rate_limit_ok( $site_id ) {
                $ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( (string) $_SERVER['REMOTE_ADDR'] ) ) : '';
                $key = 'postyar_rl_' . md5( $site_id . '|' . $ip );

                $hits = (int) get_transient( $key );
                if ( $hits >= self::RATE_LIMIT ) {
                        return false;
                }

                set_transient( $key, $hits + 1, 10 * MINUTE_IN_SECONDS );

                return true;
        }

        /* -------------------------------- مسیرها -------------------------------- */

        /**
         * GET /products — فهرست محصولات منتشرشدهٔ ووکامرس.
         *
         * @param WP_REST_Request $request درخواست.
         *
         * @return WP_REST_Response|WP_Error
         */
        public static function get_products( $request ) {
                if ( ! self::woocommerce_active() ) {
                        return new WP_Error(
                                'postyar_woocommerce_missing',
                                'برای همگام‌سازی محصولات، افزونهٔ ووکامرس باید فعال باشد.',
                                array( 'status' => 503 )
                        );
                }

                $per_page = $request->get_param( 'per_page' );
                $per_page = is_numeric( $per_page ) ? (int) $per_page : self::MAX_PER_PAGE;
                $per_page = max( 1, min( self::MAX_PER_PAGE, $per_page ) );

                $page = $request->get_param( 'page' );
                $page = is_numeric( $page ) ? max( 1, (int) $page ) : 1;

                $result   = self::query_products( $per_page, $page );

                $response = rest_ensure_response(
                        array(
                                'products' => $result['items'],
                                'total'    => $result['total'],
                                'page'     => $page,
                                'per_page' => $per_page,
                        )
                );
                $response->set_status( 200 );

                return $response;
        }

        /**
         * GET /ping — اطلاعات تشخیصی سایت.
         *
         * @return WP_REST_Response|WP_Error
         */
        public static function get_ping() {
                global $wp_version;

                return rest_ensure_response(
                        array(
                                'ok'             => true,
                                'site'           => get_bloginfo( 'url' ),
                                'wp_version'     => (string) $wp_version,
                                'wc_active'      => self::woocommerce_active(),
                                'plugin_version' => POSTYAR_CONNECTOR_VERSION,
                        )
                );
        }

        /* ------------------------------- محصولات ------------------------------- */

        /**
         * آیا ووکامرس فعال است؟
         *
         * @return bool
         */
        private static function woocommerce_active() {
                return class_exists( 'WooCommerce' ) && function_exists( 'wc_get_products' );
        }

        /**
         * واکشی محصولات منتشرشده با صفحه‌بندی امن.
         *
         * @param int $per_page تعداد در صفحه (≤۵۰).
         * @param int $page     شمارهٔ صفحه (≥۱).
         *
         * @return array{items: array<int, array<string, mixed>>, total: int}
         */
        private static function query_products( $per_page, $page ) {
                $items = array();
                $total = 0;

                // مسیر مرجع: wc_get_products با paginate برای شمارش مطمئن.
                $result = wc_get_products(
                        array(
                                'status'   => 'publish',
                                'limit'    => $per_page,
                                'page'     => $page,
                                'orderby'  => 'date',
                                'order'    => 'DESC',
                                'paginate' => true,
                                'return'   => 'objects',
                        )
                );

                if ( is_object( $result ) && property_exists( $result, 'products' ) && is_array( $result->products ) ) {
                        $objects = $result->products;
                        $total   = property_exists( $result, 'total' ) ? absint( $result->total ) : count( $objects );
                } elseif ( is_array( $result ) ) {
                        // سازگاری نسخه‌های قدیمی‌تر بدون paginate.
                        $objects = $result;
                        $total   = count( $objects );
                } else {
                        $objects = array();
                }

                foreach ( $objects as $product ) {
                        $item = self::serialize_product( $product );
                        if ( null !== $item ) {
                                $items[] = $item;
                        }
                }

                return array(
                        'items' => $items,
                        'total' => $total,
                );
        }

        /**
         * تبدیل شیء محصول به آرایهٔ قراردادی پُست‌یار (مطابق PRODUCT_PAYLOAD_SCHEMA سرویس).
         *
         * @param WC_Product $product محصول.
         *
         * @return array<string, mixed>|null
         */
        private static function serialize_product( $product ) {
                if ( ! is_object( $product ) || ! method_exists( $product, 'get_id' ) ) {
                        return null;
                }

                $price = $product->get_price();
                $price = ( '' === $price || null === $price ) ? null : (float) $price;

                $stock = $product->get_stock_quantity();

                $categories = array();
                $terms      = wp_get_post_terms( $product->get_id(), 'product_cat', array( 'fields' => 'names' ) );
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

                $permalink = get_permalink( $product->get_id() );
                $permalink = is_string( $permalink ) ? esc_url_raw( $permalink ) : null;

                $title = (string) $product->get_name();
                if ( '' === $title ) {
                        // قرارداد سرور نام خالی را نمی‌پذیرد.
                        $title = 'محصول ' . absint( $product->get_id() );
                }

                return array(
                        'id'         => absint( $product->get_id() ),
                        'title'      => mb_substr( $title, 0, 255 ),
                        'price'      => $price,
                        'stock'      => ( null === $stock ) ? null : (int) $stock,
                        'permalink'  => $permalink,
                        'categories' => $categories,
                );
        }
}
