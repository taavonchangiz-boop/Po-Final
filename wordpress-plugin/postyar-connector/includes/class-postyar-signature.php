<?php
/**
 * امضای HMAC مشترک بین افزونه و سکوی پُستیار.
 *
 * قرارداد (سمت افزونه → پُستیار و پُستیار → افزونه):
 *   X-Postyar-Signature: sha256=<hex(hmac_sha256(secret, timestamp + "\n" + rawbody))>
 *   X-Postyar-Timestamp: ثانیه‌های یونیکس
 *
 * در درخواست‌های GET بدون بدنه، preimage همان «timestamp + "\n"» (یعنی بدنهٔ خالی) است.
 *
 * سازگاری (compat): نسخهٔ فعلی سرویس SaaS امضا را روی «فقط بدنه» محاسبه می‌کند
 * (wordpress.worker.ts → signEmptyBody و wordpress.service.ts → computeSignature).
 * تا زمان هم‌تراز شدن سمت سرور با قراردادِ «timestamp + "\n" + body»،
 * متد verify() علاوه بر امضای مرجع، این حالت قدیمی را هم (فقط پس از رد شدن
 * امضای مرجع و همچنان با همان پنجرهٔ زمانی ±۳۰۰ ثانیه) می‌پذیرد.
 * هر دو مسیر نیازمند دانستن کلید مخفی هستند؛ امنیت محتوا تغییری نمی‌کند.
 *
 * @package Postyar_Connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Postyar_Signature
 */
class Postyar_Signature {

	/** پنجرهٔ مجاز اختلاف زمان (ثانیه): ±۳۰۰ مطابق قرارداد. */
	const TIMESTAMP_TOLERANCE = 300;

	/**
	 * محاسبه امضای مرجع برای یک مهر‌زمان و بدنهٔ خام.
	 *
	 * @param string $secret    کلید مخفی سایت.
	 * @param string $timestamp مهر زمان به‌صورت رشتهٔ ثانیه‌های یونیکس.
	 * @param string $body      بدنهٔ خام درخواست (برای GET رشتهٔ خالی).
	 *
	 * @return string رشتهٔ hex امضا.
	 */
	public static function sign( $secret, $timestamp, $body ) {
		return hash_hmac( 'sha256', $timestamp . "\n" . (string) $body, (string) $secret );
	}

	/**
	 * مقدار کامل هدر امضا.
	 *
	 * @param string $secret    کلید مخفی.
	 * @param string $timestamp مهر زمان.
	 * @param string $body      بدنهٔ خام.
	 *
	 * @return string مانند sha256=abcd...
	 */
	public static function header( $secret, $timestamp, $body ) {
		return 'sha256=' . self::sign( $secret, $timestamp, $body );
	}

	/**
	 * امضای «فقط بدنه» — حالت قدیمی سرویس پُستیار (فقط برای سازگاری ورودی/خروجی).
	 *
	 * @param string $secret کلید مخفی.
	 * @param string $body   بدنهٔ خام.
	 *
	 * @return string hex.
	 */
	public static function sign_body_only( $secret, $body ) {
		return hash_hmac( 'sha256', (string) $body, (string) $secret );
	}

	/**
	 * اعتبارسنجی امضای دریافتی به‌صورت زمان‌ثابت.
	 *
	 * @param string $secret    کلید مخفی ذخیره‌شده.
	 * @param string $timestamp مقدار هدر X-Postyar-Timestamp.
	 * @param string $body      بدنهٔ خام دریافتی (GET ⇒ خالی).
	 * @param string $signature مقدار هدر X-Postyar-Signature.
	 *
	 * @return bool
	 */
	public static function verify( $secret, $timestamp, $body, $signature ) {
		if ( ! is_string( $secret ) || '' === $secret ) {
			return false;
		}
		if ( ! is_string( $signature ) || '' === $signature ) {
			return false;
		}

		// طرح امضا باید sha256= باشد.
		if ( 0 !== stripos( $signature, 'sha256=' ) ) {
			return false;
		}
		$presented = substr( $signature, 7 );
		if ( ! is_string( $presented ) || '' === $presented || ! ctype_xdigit( $presented ) ) {
			return false;
		}

		// پنجرهٔ زمانی: فقط ثانیه‌های عددی و در محدودهٔ ±۳۰۰.
		if ( ! is_string( $timestamp ) || ! preg_match( '/^\d{1,13}$/', $timestamp ) ) {
			return false;
		}
		$now = time();
		$ts  = (int) $timestamp;
		if ( abs( $now - $ts ) > self::TIMESTAMP_TOLERANCE ) {
			return false;
		}

		// ۱) امضای مرجع قرارداد: timestamp + "\n" + body.
		$expected = self::sign( $secret, $timestamp, $body );
		if ( strlen( $expected ) === strlen( $presented ) && hash_equals( $expected, $presented ) ) {
			return true;
		}

		// ۲) سازگاری با نسخهٔ فعلی سرور: فقط body (پنجرهٔ زمانی بالاتر بررسی شد).
		$expected_legacy = self::sign_body_only( $secret, $body );
		if ( strlen( $expected_legacy ) === strlen( $presented ) && hash_equals( $expected_legacy, $presented ) ) {
			return true;
		}

		return false;
	}
}
