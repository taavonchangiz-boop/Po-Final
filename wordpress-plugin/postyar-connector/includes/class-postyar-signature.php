<?php
/**
 * امضای HMAC مشترک بین افزونه و سکوی پُست‌یار.
 *
 * قرارداد (سمت افزونه → پُست‌یار و پُست‌یار → افزونه):
 *   X-Postyar-Signature: sha256=<hex(hmac_sha256(secret, timestamp + "\n" + rawbody))>
 *   X-Postyar-Timestamp: ثانیه‌های یونیکس
 *
 * در درخواست‌های GET بدون بدنه، preimage همان «timestamp + "\n"» (یعنی بدنهٔ خالی) است.
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
         * محاسبه امضا برای یک مهر‌زمان و بدنهٔ خام.
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

                // ۱) امضای قرارداد: timestamp + "\n" + body.
                $expected = self::sign( $secret, $timestamp, $body );
                if ( strlen( $expected ) === strlen( $presented ) && hash_equals( $expected, $presented ) ) {
                        return true;
                }

                return false;
        }
}
