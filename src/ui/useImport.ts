import { useCallback, useRef } from 'react';
import { useStore } from '../state/store';

/** One import pipeline for every entry point: any file is routed by its content, not by which button was clicked. */
export function useImport() {
  const { importFile, notify } = useStore();
  const input = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[] | null | undefined) => {
      if (!files) return;
      // production first so the carpenter list is matched against fresh data
      const list = [...files];
      const results = [];
      for (const f of list) results.push({ f, r: await importFile(f) });
      results.sort((a, b) => (a.r.kind === 'production' ? -1 : 1) - (b.r.kind === 'production' ? -1 : 1));
      for (const { r } of results) notify(r.message, r.ok ? 'ok' : 'error');
    },
    [importFile, notify],
  );

  const openPicker = useCallback(() => input.current?.click(), []);
  return { handleFiles, openPicker, inputRef: input };
}
