'use client';

/**
 * The promo toggle and, while it is on, the promo-kind chips — the same pair
 * on every form that edits one observation.
 *
 * Turning the toggle off clears the kind: a full-price entry must never carry
 * a promo kind (the confirm schemas refuse `promoKind` without `isPromo`).
 * Turning it back on restores nothing — the caller's kind is kept only while
 * the toggle stays on.
 */
import { useTranslations } from 'next-intl';

import { Chip } from '@/components/ui/chip';
import { Toggle } from '@/components/ui/toggle';
import { PROMO_KINDS, type PromoKind } from '@/lib/domain/entries';

/** What a change touches: the toggle reports both fields, a chip only the kind. */
export type PromoFieldsPatch =
  | { isPromo: boolean; promoKind: PromoKind | null }
  | { promoKind: PromoKind };

export interface PromoFieldsProps {
  isPromo: boolean;
  promoKind: PromoKind | null;
  onChange: (patch: PromoFieldsPatch) => void;
  /** Label of the toggle. */
  toggleLabel: string;
  /** Accessible name of the chip radiogroup. */
  kindLabel: string;
  chipSize?: 'md' | 'sm';
}

/** Promo toggle plus the promo-kind radiogroup; renders as siblings, no wrapper. */
export function PromoFields({
  isPromo,
  promoKind,
  onChange,
  toggleLabel,
  kindLabel,
  chipSize,
}: PromoFieldsProps) {
  const tReview = useTranslations('review');
  return (
    <>
      <Toggle
        label={toggleLabel}
        isChecked={isPromo}
        onChange={(next) => onChange({ isPromo: next, promoKind: next ? promoKind : null })}
      />
      {isPromo && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={kindLabel}>
          {PROMO_KINDS.map((kind) => (
            <Chip
              key={kind}
              variant="filter"
              size={chipSize}
              isSelected={promoKind === kind}
              onClick={() => onChange({ promoKind: kind })}
            >
              {tReview(`promoKinds.${kind}`)}
            </Chip>
          ))}
        </div>
      )}
    </>
  );
}
