'use client';

/**
 * The Settings section for the user's data and the app on this device:
 * the install row, export to a JSON file, import from one, and the link to
 * the stores screen. It owns the hidden file input the import button
 * opens; the export and import themselves, and their pending flags, are
 * the screen's.
 */
import { Download, Store as StoreIcon, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, type ReactNode, useRef } from 'react';

import { InstallRow } from '@/components/pwa/install-row';
import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';

export interface DataSectionProps {
  isExporting: boolean;
  onExport: () => void;
  isImporting: boolean;
  /** The file input's change event, as is: the handler reads the file and clears the input. */
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** Render the install row and one row per data operation. */
export function DataSection({
  isExporting,
  onExport,
  isImporting,
  onImportFile,
}: DataSectionProps) {
  const t = useTranslations('settings');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section aria-labelledby="settings-data" className="flex flex-col gap-3">
      <SectionHeading id="settings-data">{t('data.title')}</SectionHeading>
      <InstallRow />
      <DataRow
        title={t('data.export')}
        body={t('data.exportHelp')}
        action={
          <Button
            variant="secondary"
            icon={<Download className="size-4" />}
            isPending={isExporting}
            onClick={onExport}
            data-testid="export-data"
          >
            {t('data.export')}
          </Button>
        }
      />
      <DataRow
        title={t('data.import')}
        body={t('data.importHelp')}
        action={
          <>
            <Button
              variant="secondary"
              icon={<Upload className="size-4" />}
              isPending={isImporting}
              onClick={() => fileInputRef.current?.click()}
              data-testid="import-data"
            >
              {isImporting ? t('data.importing') : t('data.import')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={onImportFile}
              aria-label={t('data.import')}
              className="sr-only"
              data-testid="import-file-input"
            />
          </>
        }
      />
      <DataRow
        title={t('data.stores')}
        body={t('data.storesHelp')}
        action={
          <Button href="/stores" variant="secondary" icon={<StoreIcon className="size-4" />}>
            {t('data.stores')}
          </Button>
        }
      />
    </section>
  );
}

/** One bordered row: what the operation does on the left, its control on the right. */
function DataRow({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-surface p-3 tablet:flex-row tablet:items-center tablet:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-sans font-medium text-[15px] text-text">{title}</span>
        <span className="font-sans text-[13px] text-text-muted leading-snug">{body}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">{action}</div>
    </div>
  );
}
