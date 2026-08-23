'use client';

/**
 * A decimal input that owns its text while the user types and emits parsed
 * numbers upward. Why not a controlled number: "2," is not a number yet but
 * must stay on screen, and Italian keyboards type commas — so the string is
 * the source of truth while focused, and the numeric prop re-syncs it only
 * when the field is not being edited (e.g. an auto-computed value landed).
 */
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';

import { type AppLocale, formatInputDecimal, parseDecimalInput } from '@/lib/format';
import { Input, type InputProps } from './input';

export interface DecimalInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type'> {
  /** The numeric value in display units (euros, litres…); null when empty. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Decimals kept when echoing an external value back into the box. */
  maxDecimals?: number;
}

export function DecimalInput({
  value,
  onValueChange,
  maxDecimals = 3,
  onFocus,
  onBlur,
  ...inputProps
}: DecimalInputProps) {
  const locale = useLocale() as AppLocale;
  const [text, setText] = useState(
    value === null ? '' : formatInputDecimal(value, locale, maxDecimals),
  );
  const [isFocused, setIsFocused] = useState(false);

  // Re-sync from the prop only while not editing, so a derived value shows
  // up but never overwrites keystrokes.
  useEffect(() => {
    if (isFocused) {
      return;
    }
    setText(value === null ? '' : formatInputDecimal(value, locale, maxDecimals));
  }, [value, isFocused, maxDecimals, locale]);

  return (
    <Input
      {...inputProps}
      type="text"
      isMoney
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        onValueChange(next.trim() === '' ? null : parseDecimalInput(next));
      }}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        onBlur?.(event);
      }}
    />
  );
}
