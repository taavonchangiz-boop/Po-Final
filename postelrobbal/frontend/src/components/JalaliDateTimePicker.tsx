import DatePicker from 'react-multi-date-picker';
import type DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import TimePicker from 'react-multi-date-picker/plugins/time_picker';

/**
 * Shamsi-only date & time picker (feedback round 15, item 8).
 * All scheduling / search / filter date entry in the app MUST go through
 * this component — Gregorian inputs (type="date"/"datetime-local") are not
 * allowed anywhere in the UI.
 */
export function JalaliDateTimePicker({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ و ساعت (شمسی)',
  disabled = false,
  restrictToFuture = false,
}: {
  value: Date | null;
  onChange: (d: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** For scheduling: disable past dates. Off for search/filter usage. */
  restrictToFuture?: boolean;
}) {
  return (
    <DatePicker
      value={value}
      onChange={(d) => {
        const obj = (Array.isArray(d) ? d[0] : d) as DateObject | null;
        onChange(obj && obj.isValid ? obj.toDate() : null);
      }}
      calendar={persian}
      locale={persian_fa}
      format="YYYY/MM/DD HH:mm"
      plugins={[<TimePicker position="bottom" key="tp" />]}
      inputClass="input"
      placeholder={placeholder}
      editable={false}
      disabled={disabled}
      calendarPosition="bottom-right"
      digits={['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']}
      minDate={restrictToFuture ? new Date() : undefined}
    />
  );
}
