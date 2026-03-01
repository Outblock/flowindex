import { useRef, useCallback } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { registerCadenceLanguage, CADENCE_LANGUAGE_ID } from './cadenceLanguage';
import { registerCadenceThemes, CADENCE_DARK_THEME, CADENCE_LIGHT_THEME } from './cadenceTheme';

interface CadenceEditorProps {
  code: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  darkMode?: boolean;
  externalEditorRef?: React.RefObject<editor.IStandaloneCodeEditor | null>;
}

export default function CadenceEditor({ code, onChange, onRun, darkMode = true, externalEditorRef }: CadenceEditorProps) {
  const internalRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const editorRef = externalEditorRef || internalRef;

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerCadenceLanguage(monaco);
    registerCadenceThemes(monaco);
  }, []);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Ctrl/Cmd+Enter to run
      editor.addAction({
        id: 'cadence-run',
        label: 'Run Cadence',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => {
          onRun?.();
        },
      });

      editor.focus();
    },
    [onRun]
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value ?? '');
    },
    [onChange]
  );

  return (
    <Editor
      language={CADENCE_LANGUAGE_ID}
      theme={darkMode ? CADENCE_DARK_THEME : CADENCE_LIGHT_THEME}
      value={code}
      onChange={handleChange}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "'GeistMono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        automaticLayout: true,
        wordWrap: 'on',
        smoothScrolling: true,
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        lineNumbers: 'on',
        renderLineHighlight: 'line',
        bracketPairColorization: { enabled: true },
        tabSize: 2,
      }}
    />
  );
}
