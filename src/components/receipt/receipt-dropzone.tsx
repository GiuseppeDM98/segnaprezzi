'use client';

/**
 * File picker and drop target for one receipt.
 *
 * A dashed frame on the page rather than a card: this is an empty slot
 * waiting to be filled, and DESIGN.md gives dashed hairlines exactly that
 * job. It never uploads anything itself — the screen owns the request, so
 * this component never imports a Server Action or `fetch`.
 */
import { FileText, ImageIcon, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type DragEvent, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cx } from '@/lib/cx';

/** What the file input offers and what the route handler will accept. */
const ACCEPTED_TYPES = 'application/pdf,image/*';

export interface ReceiptDropzoneProps {
  file: File | null;
  onSelect: (file: File | null) => void;
  disabled?: boolean;
  /** Pre-formatted size caption ("1,2 MB"); the component never formats. */
  sizeLabel: string | null;
}

export function ReceiptDropzone({
  file,
  onSelect,
  disabled = false,
  sizeLabel,
}: ReceiptDropzoneProps) {
  const t = useTranslations('receipt');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) {
      return;
    }
    const dropped = event.dataTransfer.files.item(0);
    if (dropped) {
      onSelect(dropped);
    }
  }

  const Icon = file?.type === 'application/pdf' ? FileText : file ? ImageIcon : Upload;

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: a drop target has no
       interactive ARIA role that fits — the real controls are the file input
       and its button, which is what keyboard and assistive-tech users
       operate. Dropping is a pointer-only enhancement on top of them. */
    <div
      onDrop={handleDrop}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      data-testid="receipt-dropzone"
      className={cx(
        'flex flex-col items-center gap-4 rounded-control border border-dashed px-6 py-10 text-center transition-colors',
        isDragging ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
        disabled && 'opacity-50',
      )}
    >
      <Icon aria-hidden="true" className="size-8 text-text-muted" />

      {file ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-mono text-[14px] text-text">{file.name}</p>
          {sizeLabel && <p className="font-sans text-[13px] text-text-muted">{sizeLabel}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-pretty font-sans text-[15px] text-text">{t('dropzone')}</p>
          <p className="font-sans text-[13px] text-text-muted">{t('dropzoneHint')}</p>
        </div>
      )}

      {/* The visible control is the button; the input stays reachable by
          assistive tech, which needs its own name (AGENTS.md §4.37). */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_TYPES}
        disabled={disabled}
        aria-label={t('choose')}
        data-testid="receipt-file-input"
        className="sr-only"
        onChange={(event) => onSelect(event.target.files?.item(0) ?? null)}
      />
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        data-testid="receipt-choose"
      >
        {file ? t('change') : t('choose')}
      </Button>
    </div>
  );
}
