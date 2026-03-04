import { useRef, useCallback, useEffect, useState } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { registerCadenceLanguage, CADENCE_LANGUAGE_ID } from './cadenceLanguage';
import { registerCadenceThemes, CADENCE_DARK_THEME, CADENCE_LIGHT_THEME } from './cadenceTheme';
import { activateCadenceTextmate } from './cadenceTextmate';

interface CadenceEditorProps {
  code: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  onGoToDefinition?: (path: string, line: number, column: number) => Promise<boolean> | boolean;
  darkMode?: boolean;
  /** File path — used as Monaco model key. Switching path preserves cursor/undo per file. */
  path?: string;
  readOnly?: boolean;
  externalEditorRef?: React.RefObject<editor.IStandaloneCodeEditor | null>;
  onMonacoReady?: (monaco: typeof import('monaco-editor')) => void;
}

export default function CadenceEditor({
  code, onChange, onRun, onGoToDefinition, darkMode = true, path, readOnly,
  externalEditorRef, onMonacoReady,
}: CadenceEditorProps) {
  const internalRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const editorRef = externalEditorRef || internalRef;

  // Keep a stable ref to onRun so the Monaco action always calls the latest version
  const onRunRef = useRef(onRun);
  useEffect(() => { onRunRef.current = onRun; }, [onRun]);

  const [tmReady, setTmReady] = useState(false);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    // Register Monarch as fallback first — TextMate will override once WASM loads
    registerCadenceLanguage(monaco);
    registerCadenceThemes(monaco);
    onMonacoReady?.(monaco);
    // Load TextMate grammar async (overrides Monarch tokenizer)
    activateCadenceTextmate(monaco).then(() => setTmReady(true)).catch(console.error);
  }, [onMonacoReady]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      const goToDefinitionAt = async (position: { lineNumber: number; column: number } | null | undefined) => {
        if (!position || !onGoToDefinition) return;
        const model = editor.getModel();
        if (!model) return;

        const filePath = decodeURIComponent(model.uri.path.replace(/^\/+/, ''));
        const attempts = new Set<number>([position.column - 1]);
        const word = model.getWordAtPosition(position);
        if (word) {
          attempts.add(word.startColumn - 1);
          attempts.add(word.endColumn - 2);
        } else if (position.column > 1) {
          attempts.add(position.column - 2);
        }

        for (const column of attempts) {
          const handled = await onGoToDefinition(filePath, position.lineNumber - 1, Math.max(0, column));
          if (handled) return;
        }
      };

      // Ctrl/Cmd+Enter to run — use ref to always call the latest onRun
      editor.addAction({
        id: 'cadence-run',
        label: 'Run Cadence',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => {
          onRunRef.current?.();
        },
      });

      editor.addCommand(monaco.KeyCode.F12, () => {
        void goToDefinitionAt(editor.getPosition());
      });

      editor.onMouseDown((e) => {
        if (!(e.event.metaKey || e.event.ctrlKey)) return;
        if (!e.target.position) return;
        if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;

        e.event.preventDefault();
        e.event.stopPropagation();
        void goToDefinitionAt(e.target.position);
      });

      editor.focus();
    },
    [onGoToDefinition]
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
      path={path}
      onChange={handleChange}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: window.innerWidth < 768 ? 16 : 13,
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
        // Force Cmd/Ctrl+Click and F12 to jump directly instead of opening peek UI.
        definitionLinkOpensInPeek: false,
        gotoLocation: {
          multipleDefinitions: 'goto',
          multipleTypeDefinitions: 'goto',
          multipleDeclarations: 'goto',
          multipleImplementations: 'goto',
          multipleReferences: 'goto',
        },
        readOnly,
      }}
    />
  );
}
