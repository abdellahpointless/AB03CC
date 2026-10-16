import { useCallback, useRef } from 'react';
import { useStore, type ImportOutcome } from '../state/store';

/** One import pipeline for every entry point: any file is routed by its content, not by which button was clicked. */
export function useImport() {
  const { importFile, notify, askCarpenter } = useStore();
  const input = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[] | null | undefined) => {
      if (!files) return;
      // production first so the carpenter list is matched against fresh data
      const list = [...files];
      const results: Array<{ f: File; r: ImportOutcome }> = [];
      for (const f of list) results.push({ f, r: await importFile(f) });
      results.sort((a, b) => (a.r.kind === 'production' ? -1 : 1) - (b.r.kind === 'production' ? -1 : 1));
      for (const { r } of results) notify(r.message, r.ok ? 'ok' : 'error');
      // a new workload without a carpenter list in the same import: ask for today's carpenter list before planning
      const got = (k: string) => results.some(x => x.r.ok && x.r.kind === k);
      if (got('production') && !got('carpenter')) askCarpenter();
    },
    [importFile, notify, askCarpenter],
  );

  const openPicker = useCallback(() => input.current?.click(), []);
  return { handleFiles, openPicker, inputRef: input };
}
