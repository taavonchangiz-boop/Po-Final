<?php
/**
 * صفحهٔ تنظیمات افزونه (فارسی/راست‌به‌چپ) با Settings API استاندارد وردپرس.
 *
 * گزینه‌ها:
 *   postyar_connector_settings  آرایهٔ { postyar_api_url, postyar_site_public_id, auto_publish_channels }
 *   postyar_connector_secret    کلید مخفی HMAC (گزینهٔ مستقل؛ پس از ذخیره هرگز نمایش داده نمی‌شود)
 *
 * ذخیرهٔ فرم اصلی از options.php می‌گذرد (nonce + manage_options به‌صورت خودکار)
 * و تغییر کلید از مسیر admin-post.php با nonce اختصاصی انجام می‌شود.
 *
 * @package Postyar_Connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Postyar_Settings
 */
class Postyar_Settings {

	/** اسلاگ صفحهٔ تنظیمات. */
	const PAGE_SLUG = 'postyar-connector';

	/**
	 * ثبت هوک‌های مدیریت.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_settings_page' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
		add_action( 'admin_post_postyar_save_secret', array( __CLASS__, 'handle_save_secret' ) );
	}

	/* ------------------------------ خواندن ------------------------------ */

	/**
	 * تنظیمات پیش‌فرض.
	 *
	 * @return array<string, string>
	 */
	public static function defaults() {
		return array(
			'postyar_api_url'        => '',
			'postyar_site_public_id' => '',
			'auto_publish_channels'  => '',
		);
	}

	/**
	 * تنظیمات ذخیره‌شده (ادغام‌شده با پیش‌فرض‌ها).
	 *
	 * @return array<string, string>
	 */
	public static function get_settings() {
		$saved = get_option( 'postyar_connector_settings', array() );
		$saved = is_array( $saved ) ? $saved : array();

		return array_merge( self::defaults(), $saved );
	}

	/**
	 * کلید مخفی ذخیره‌شده (هرگز به خروجی نمایشی کامل برگردانده نمی‌شود).
	 *
	 * @return string
	 */
	public static function get_secret() {
		$secret = get_option( 'postyar_connector_secret', '' );

		return is_string( $secret ) ? $secret : '';
	}

	/**
	 * آیا جفت‌سازی کامل است (شناسهٔ سایت + کلید)؟
	 *
	 * @return bool
	 */
	public static function is_paired() {
		$settings = self::get_settings();

		return '' !== $settings['postyar_site_public_id'] && '' !== self::get_secret();
	}

	/**
	 * چهار نویسهٔ پایانی کلید برای نمایش.
	 *
	 * @return string مانند «•••• a9f3».
	 */
	public static function get_secret_hint() {
		$secret = self::get_secret();

		if ( '' === $secret ) {
			return '';
		}

		return '•••• ' . mb_substr( $secret, -4 );
	}

	/* --------------------------- منو و ثبت --------------------------- */

	/**
	 * افزودن صفحهٔ تنظیمات زیر «تنظیمات».
	 *
	 * @return void
	 */
	public static function add_settings_page() {
		add_options_page(
			__( 'پُست‌یار کانکتور', 'postyar-connector' ),
			__( 'پُست‌یار کانکتور', 'postyar-connector' ),
			'manage_options',
			self::PAGE_SLUG,
			array( __CLASS__, 'render_page' )
		);
	}

	/**
	 * ثبت گزینه‌ها با توابع پاک‌سازی (Settings API؛ nonce و سطح دسترسی را وردپرس برمی‌رسد).
	 *
	 * @return void
	 */
	public static function register_settings() {
		register_setting(
			'postyar_connector_group',
			'postyar_connector_settings',
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize_settings' ),
				'default'           => self::defaults(),
			)
		);
	}

	/**
	 * پاک‌سازی و اعتبارسنجی تنظیمات.
	 *
	 * @param mixed $input ورودی خام فرم.
	 *
	 * @return array<string, string>
	 */
	public static function sanitize_settings( $input ) {
		$clean = self::defaults();

		$input = is_array( $input ) ? $input : array();

		// نشانی پایهٔ پُست‌یار — فقط http/https با میزبان غیرخالی (محافظ SSRF).
		$api_url = isset( $input['postyar_api_url'] ) ? sanitize_text_field( wp_unslash( (string) $input['postyar_api_url'] ) ) : '';
		if ( '' !== $api_url ) {
			$parts  = wp_parse_url( $api_url );
			$host   = is_array( $parts ) && ! empty( $parts['host'] ) ? (string) $parts['host'] : '';
			$scheme = is_array( $parts ) && isset( $parts['scheme'] ) ? strtolower( (string) $parts['scheme'] ) : '';

			if ( '' === $host || ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
				add_settings_error(
					'postyar_connector_settings',
					'postyar_invalid_api_url',
					'نشانی پُست‌یار نامعتبر است؛ باید با http یا https شروع شود و میزبان داشته باشد.',
					'error'
				);
				$api_url = '';
			} else {
				$api_url = untrailingslashit( esc_url_raw( $api_url, array( 'http', 'https' ) ) );
			}
		}
		$clean['postyar_api_url'] = $api_url;

		// شناسهٔ عمومی سایت (از پنل پُست‌یار دریافت می‌شود).
		$public_id = isset( $input['postyar_site_public_id'] ) ? sanitize_text_field( wp_unslash( (string) $input['postyar_site_public_id'] ) ) : '';
		if ( '' !== $public_id && ! preg_match( '/^[A-Za-z0-9_\-]{4,128}$/', $public_id ) ) {
			add_settings_error(
				'postyar_connector_settings',
				'postyar_invalid_public_id',
				'شناسهٔ سایت باید بین ۴ تا ۱۲۸ نویسهٔ لاتین، رقم، خط تیره یا زیرخط باشد.',
				'error'
			);
			$public_id = '';
		}
		$clean['postyar_site_public_id'] = $public_id;

		// کانال‌های انتشار خودکار — رزروشده برای نسخه‌های بعدی.
		$channels                        = isset( $input['auto_publish_channels'] ) ? sanitize_text_field( wp_unslash( (string) $input['auto_publish_channels'] ) ) : '';
		$clean['auto_publish_channels'] = $channels;

		return $clean;
	}

	/* --------------------------- جریان کلید --------------------------- */

	/**
	 * ذخیرهٔ کلید مخفی از فرم اختصاصی «تغییر کلید».
	 * بررسی nonce + manage_options؛ کلید پس از ذخیره هرگز نمایش داده نمی‌شود.
	 *
	 * @return void
	 */
	public static function handle_save_secret() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'شما مجاز به انجام این کار نیستید.', 'postyar-connector' ) );
		}

		check_admin_referer( 'postyar_save_secret', 'postyar_secret_nonce' );

		$secret = isset( $_POST['postyar_site_secret'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['postyar_site_secret'] ) ) : '';
		$status = 'saved';

		if ( '' === $secret || mb_strlen( $secret ) < 16 ) {
			$status = 'error';

			add_settings_error(
				'postyar_connector_settings',
				'postyar_invalid_secret',
				'کلید مخفی نامعتبر است؛ کلیدِ نمایش‌داده‌شده در پنل پُست‌یار را کامل و بدون فاصله وارد کنید.',
				'error'
			);
		} else {
			update_option( 'postyar_connector_secret', $secret, false );

			add_settings_error(
				'postyar_connector_settings',
				'postyar_secret_saved',
				'کلید مخفی ذخیره شد. از این پس فقط چهار نویسهٔ پایانی آن نمایش داده می‌شود.',
				'updated'
			);
		}

		// پیام‌ها با یک گذر از طریق transient منتقل می‌شوند.
		set_transient( 'settings_errors', get_settings_errors(), 30 );

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'   => self::PAGE_SLUG,
					'secret' => $status,
				),
				admin_url( 'options-general.php' )
			)
		);
		exit;
	}

	/* ------------------------------ نما ------------------------------ */

	/**
	 * نمایش صفحهٔ تنظیمات (فارسی/راست‌به‌چپ).
	 * سه فرم مستقل و هم‌تراز: تنظیمات اصلی، کلید مخفی، و کارت وضعیت/تست اتصال.
	 *
	 * @return void
	 */
	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'شما مجاز به مشاهدهٔ این صفحه نیستید.', 'postyar-connector' ) );
		}

		$settings   = self::get_settings();
		$secret_set = '' !== self::get_secret();
		$hint       = self::get_secret_hint();
		$secret_msg = isset( $_GET['secret'] ) ? sanitize_key( wp_unslash( (string) $_GET['secret'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		$rest_url = rest_url( 'postyar-connector/v1/products' );
		?>
		<div class="wrap postyar-wrap" dir="rtl">
			<h1><?php esc_html_e( 'پُست‌یار کانکتور', 'postyar-connector' ); ?></h1>
			<p class="postyar-lead">
				<?php esc_html_e( 'این افزونه فروشگاه ووکامرس شما را به سکوی پُست‌یار متصل می‌کند. اطلاعات جفت‌سازی را از پنل پُست‌یار (بخش سایت‌های وردپرس) دریافت کنید.', 'postyar-connector' ); ?>
			</p>

			<?php if ( 'saved' === $secret_msg ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'کلید مخفی با موفقیت ذخیره شد. این کلید دیگر نمایش داده نمی‌شود.', 'postyar-connector' ); ?></p></div>
			<?php elseif ( 'error' === $secret_msg ) : ?>
				<div class="notice notice-error is-dismissible"><p><?php esc_html_e( 'ذخیرهٔ کلید مخفی ناموفق بود؛ کلید را کامل و بدون فاصله وارد کنید.', 'postyar-connector' ); ?></p></div>
			<?php endif; ?>
			<?php settings_errors( 'postyar_connector_settings' ); ?>

			<form method="post" action="options.php">
				<?php settings_fields( 'postyar_connector_group' ); ?>

				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="postyar_api_url"><?php esc_html_e( 'نشانی پُست‌یار', 'postyar-connector' ); ?></label></th>
						<td>
							<input type="url" id="postyar_api_url" name="postyar_connector_settings[postyar_api_url]"
								value="<?php echo esc_attr( $settings['postyar_api_url'] ); ?>" class="regular-text ltr"
								placeholder="https://app.postyar.ir" autocomplete="off" />
							<p class="description"><?php esc_html_e( 'نشانی پایهٔ سکوی پُست‌یار، مانند https://app.postyar.ir', 'postyar-connector' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="postyar_site_public_id"><?php esc_html_e( 'شناسهٔ سایت (Public ID)', 'postyar-connector' ); ?></label></th>
						<td>
							<input type="text" id="postyar_site_public_id" name="postyar_connector_settings[postyar_site_public_id]"
								value="<?php echo esc_attr( $settings['postyar_site_public_id'] ); ?>" class="regular-text code ltr"
								placeholder="py_site_xxxxxxxx" autocomplete="off" />
							<p class="description"><?php esc_html_e( 'شناسهٔ عمومی سایت که هنگام ساخت سایت در پنل پُست‌یار به شما نشان داده می‌شود.', 'postyar-connector' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="auto_publish_channels"><?php esc_html_e( 'کانال‌های انتشار خودکار', 'postyar-connector' ); ?></label></th>
						<td>
							<input type="text" id="auto_publish_channels" name="postyar_connector_settings[auto_publish_channels]"
								value="<?php echo esc_attr( $settings['auto_publish_channels'] ); ?>" class="regular-text ltr"
								placeholder="telegram, bale" />
							<p class="description"><?php esc_html_e( 'برای نسخه‌های بعدی — فهرست کانال‌ها با کاما جدا می‌شود.', 'postyar-connector' ); ?></p>
						</td>
					</tr>
				</table>

				<?php submit_button( __( 'ذخیرهٔ تنظیمات', 'postyar-connector' ) ); ?>
			</form>

			<hr />

			<h2><?php esc_html_e( 'کلید مخفی', 'postyar-connector' ); ?></h2>
			<?php if ( $secret_set ) : ?>
				<p>
					<span class="postyar-secret-label"><?php esc_html_e( 'کلید ذخیره‌شده:', 'postyar-connector' ); ?></span>
					<code class="postyar-secret-hint"><?php echo esc_html( $hint ); ?></code>
				</p>
				<details class="postyar-secret-change">
					<summary><?php esc_html_e( 'تغییر کلید', 'postyar-connector' ); ?></summary>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<input type="hidden" name="action" value="postyar_save_secret" />
						<?php wp_nonce_field( 'postyar_save_secret', 'postyar_secret_nonce' ); ?>
						<p>
							<input type="password" name="postyar_site_secret" class="regular-text code ltr"
								value="" placeholder="<?php esc_attr_e( 'کلید مخفی جدید', 'postyar-connector' ); ?>"
								autocomplete="new-password" />
							<?php submit_button( __( 'ذخیرهٔ کلید', 'postyar-connector' ), 'secondary', 'submit', false ); ?>
						</p>
						<p class="description"><?php esc_html_e( 'با چرخش کلید در پنل پُست‌یار، کلید جدید را همین‌جا وارد کنید. کلید پس از ذخیره نمایش داده نمی‌شود.', 'postyar-connector' ); ?></p>
					</form>
				</details>
			<?php else : ?>
				<p class="description"><?php esc_html_e( 'کلید مخفی هنگام ساخت سایت در پنل پُست‌یار فقط یک‌بار نمایش داده می‌شود؛ آن را همین‌جا ذخیره کنید.', 'postyar-connector' ); ?></p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="postyar_save_secret" />
					<?php wp_nonce_field( 'postyar_save_secret', 'postyar_secret_nonce' ); ?>
					<p>
						<input type="password" name="postyar_site_secret" class="regular-text code ltr"
							value="" placeholder="<?php esc_attr_e( 'کلید مخفی سایت', 'postyar-connector' ); ?>"
							autocomplete="new-password" />
						<?php submit_button( __( 'ذخیرهٔ کلید', 'postyar-connector' ), 'primary', 'submit', false ); ?>
					</p>
				</form>
			<?php endif; ?>

			<hr />

			<h2><?php esc_html_e( 'اطلاعات اتصال', 'postyar-connector' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'نشانی همگام‌سازی محصولات', 'postyar-connector' ); ?></th>
					<td><code class="ltr"><?php echo esc_html( $rest_url ); ?></code></td>
				</tr>
			</table>

			<?php Postyar_Admin::render_status_card(); ?>
			<?php Postyar_Admin::render_diagnostics(); ?>
		</div>
		<?php
	}
}
