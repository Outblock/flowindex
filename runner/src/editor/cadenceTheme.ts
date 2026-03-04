import type { editor } from 'monaco-editor';

export const CADENCE_DARK_THEME = 'cadence-dark';
export const CADENCE_LIGHT_THEME = 'cadence-light';

export const cadenceDarkTheme: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'C792EA', fontStyle: 'bold' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'type.identifier', foreground: '4EC9B0' },
    { token: 'identifier', foreground: 'D4D4D4' },
    { token: 'function', foreground: 'DCDCAA' },
    { token: 'parameter', foreground: '9CDCFE' },
    { token: 'variable.property', foreground: '9CDCFE' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'number.hex', foreground: 'B5CEA8' },
    { token: 'number.float', foreground: 'B5CEA8' },
    { token: 'number.binary', foreground: 'B5CEA8' },
    { token: 'number.octal', foreground: 'B5CEA8' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'string.escape', foreground: 'D7BA7D' },
    { token: 'string.invalid', foreground: 'F44747' },
    { token: 'string.path', foreground: 'CE9178' },
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'operator', foreground: 'D4D4D4' },
    { token: 'operator.move', foreground: 'C792EA', fontStyle: 'bold' },
    { token: 'annotation', foreground: 'DCDCAA' },
    { token: 'delimiter', foreground: 'D4D4D4' },
    { token: 'delimiter.angle', foreground: 'FFD700' },
    { token: 'delimiter.bracket', foreground: 'FFD700' },
  ],
  colors: {
    'editor.background': '#18181B',
    'editor.foreground': '#D4D4D4',
    'editor.lineHighlightBackground': '#27272A',
    'editor.selectionBackground': '#3F3F46',
    'editorCursor.foreground': '#A78BFA',
    'editorLineNumber.foreground': '#52525B',
    'editorLineNumber.activeForeground': '#A1A1AA',
    'editor.inactiveSelectionBackground': '#3F3F4680',
  },
};

export const cadenceLightTheme: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '7C3AED', fontStyle: 'bold' },
    { token: 'type', foreground: '0D9488' },
    { token: 'type.identifier', foreground: '0D9488' },
    { token: 'identifier', foreground: '1F2937' },
    { token: 'function', foreground: '92400E' },
    { token: 'parameter', foreground: '1E40AF' },
    { token: 'variable.property', foreground: '1E40AF' },
    { token: 'number', foreground: '16A34A' },
    { token: 'number.hex', foreground: '16A34A' },
    { token: 'number.float', foreground: '16A34A' },
    { token: 'number.binary', foreground: '16A34A' },
    { token: 'number.octal', foreground: '16A34A' },
    { token: 'string', foreground: 'DC2626' },
    { token: 'string.escape', foreground: 'B45309' },
    { token: 'string.invalid', foreground: 'EF4444' },
    { token: 'string.path', foreground: 'DC2626' },
    { token: 'comment', foreground: '16A34A', fontStyle: 'italic' },
    { token: 'operator', foreground: '374151' },
    { token: 'operator.move', foreground: '7C3AED', fontStyle: 'bold' },
    { token: 'annotation', foreground: 'B45309' },
    { token: 'delimiter', foreground: '374151' },
    { token: 'delimiter.angle', foreground: '6D28D9' },
    { token: 'delimiter.bracket', foreground: '6D28D9' },
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#1F2937',
    'editor.lineHighlightBackground': '#F5F5F5',
    'editor.selectionBackground': '#E5E7EB',
    'editorCursor.foreground': '#7C3AED',
    'editorLineNumber.foreground': '#D1D5DB',
    'editorLineNumber.activeForeground': '#6B7280',
  },
};

export function registerCadenceThemes(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme(CADENCE_DARK_THEME, cadenceDarkTheme);
  monaco.editor.defineTheme(CADENCE_LIGHT_THEME, cadenceLightTheme);
}
