import { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import axios from 'axios';

// Use same-origin /api/ path — nginx proxies to backend
const API_URL = '';

export function useCadenceCheck(
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>,
  code: string,
  network: string
) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!editorRef.current || !code.trim()) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await axios.post(`${API_URL}/api/cadence/check`, { code, network });
        const model = editorRef.current?.getModel();
        if (!model) return;
        const monaco = await import('monaco-editor');
        const markers: Monaco.editor.IMarkerData[] = (data.diagnostics || []).map((d: any) => ({
          severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.startLine || 1,
          startColumn: d.startColumn || 1,
          endLineNumber: d.endLine || d.startLine || 1,
          endColumn: d.endColumn || 100,
        }));
        monaco.editor.setModelMarkers(model, 'cadence', markers);
      } catch {
        // Best-effort, silently fail
      }
    }, 500);

    return () => clearTimeout(timerRef.current);
  }, [code, network]);
}
