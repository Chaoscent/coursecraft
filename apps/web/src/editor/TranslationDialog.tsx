// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { FormGrid, FormRow, SelectField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { useEditor, useEditorStore } from './context.js';
import { chooseFile } from './upload.js';
import { exportXliff, importXliff, XliffError, type XliffVersion } from './xliff.js';

const TARGETS = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'pl',
  'pt',
  'tr',
  'cs',
  'da',
  'sv',
  'fi',
  'no',
  'hu',
  'ro',
  'uk',
  'ru',
  'zh',
  'ja',
  'ar',
];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** XLIFF export for translators and import of the translated file. */
export function TranslationDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const course = useEditor((s) => s.course);
  const readOnly = useEditor((s) => s.readOnly);
  const source = course.languages.default;
  const targets = [...new Set([...course.languages.available, ...TARGETS])].filter((l) => l !== source);
  const [target, setTarget] = useState(targets[0] ?? 'en');
  const [version, setVersion] = useState<XliffVersion>('2.1');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const download = () => {
    const xml = exportXliff(store.getState().course, target, version);
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xliff+xml' }));
    const link = document.createElement('a');
    const title = (course.meta.title[source] ?? 'course').replace(/[^\p{L}\p{N}_-]+/gu, '-');
    link.href = url;
    link.download = `${title}.${source}-${target}.xlf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const upload = async () => {
    setMessage(null);
    const file = await chooseFile('.xlf,.xliff,application/xliff+xml,application/xml,text/xml');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setMessage({ tone: 'danger', text: t('translation.tooLarge') });
      return;
    }
    try {
      const result = importXliff(store.getState().course, await file.text());
      store.getState().change((draft) => {
        draft.languages = result.course.languages;
        draft.meta = result.course.meta;
        draft.structure = result.course.structure;
        draft.nodes = result.course.nodes;
      }, 'xliff');
      setMessage({
        tone: 'success',
        text: t('translation.imported', {
          lang: result.lang,
          updated: result.updated,
          skipped: result.skipped,
        }),
      });
    } catch (e) {
      const code = e instanceof XliffError ? e.message : 'not-xliff';
      setMessage({ tone: 'danger', text: t(`translation.errors.${code}`) });
    }
  };

  return (
    <Dialog
      title={t('translation.title')}
      isOpen
      onClose={onClose}
      footer={<Button onPress={onClose}>{t('common.close')}</Button>}
    >
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <p>{t('translation.intro', { source })}</p>
      <FormGrid wide>
        <SelectField
          label={t('translation.target')}
          value={target}
          onChange={setTarget}
          options={targets.map((l) => ({ id: l, label: l }))}
        />
        <SelectField
          label={t('translation.format')}
          value={version}
          onChange={setVersion}
          options={[
            { id: '2.1', label: 'XLIFF 2.1' },
            { id: '1.2', label: 'XLIFF 1.2' },
          ]}
        />
        <FormRow label="">
          <div>
            <Button icon="download" onPress={download}>
              {t('translation.export')}
            </Button>
          </div>
        </FormRow>
        <FormRow label="">
          <div>
            <Button icon="upload" isDisabled={readOnly} onPress={() => void upload()}>
              {t('translation.import')}
            </Button>
          </div>
        </FormRow>
      </FormGrid>
    </Dialog>
  );
}
