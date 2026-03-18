import type { languages } from 'monaco-editor';

export const CADENCE_LANGUAGE_ID = 'cadence';

export const cadenceLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: '//',
    blockComment: ['/*', '*/'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
    ['<', '>'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '<', close: '>' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: '/*', close: '*/', notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '<', close: '>' },
    { open: '"', close: '"' },
  ],
  folding: {
    markers: {
      start: /^\s*\/\/\s*#?region\b/,
      end: /^\s*\/\/\s*#?endregion\b/,
    },
  },
  indentationRules: {
    increaseIndentPattern: /^.*\{[^}"']*$/,
    decreaseIndentPattern: /^\s*\}/,
  },
};

export const cadenceTokenProvider: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.cadence',

  keywords: [
    'if', 'else', 'while', 'for', 'in', 'return', 'break', 'continue',
    'fun', 'let', 'var',
    'transaction', 'prepare', 'execute', 'pre', 'post',
    'access', 'all', 'self', 'account', 'auth',
    'contract', 'resource', 'struct', 'event', 'emit', 'enum', 'case',
    'interface', 'entitlement', 'mapping', 'require',
    'create', 'destroy', 'move', 'attach', 'remove',
    'nil', 'true', 'false',
    'pub', 'priv',
    'init', 'view',
    'switch', 'default',
    'try', 'catch',
    'where', 'panic', 'log',
    'import', 'from',
  ],

  typeKeywords: [
    'String', 'Bool', 'Address', 'Void', 'Never', 'AnyStruct', 'AnyResource',
    'Character', 'Path', 'StoragePath', 'PublicPath', 'PrivatePath', 'CapabilityPath',
    'Type', 'Block', 'Capability',
    'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256',
    'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256',
    'Word8', 'Word16', 'Word32', 'Word64', 'Word128', 'Word256',
    'Fix64', 'UFix64',
    'AuthAccount', 'PublicAccount', 'Account',
    'Storage', 'BorrowValue', 'Capabilities', 'SaveValue', 'LoadValue',
    'Inbox', 'Keys', 'Contracts', 'CompositeType',
  ],

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      // Whitespace & comments first
      { include: '@whitespace' },

      // Move operator — must come before generic symbol matching
      [/<-!|<-/, 'operator.move'],

      // Path literals: /storage/xxx, /public/xxx, /private/xxx
      [/\/(?:storage|public|private)\/\w+/, 'string.path'],

      // import statements: `import X from 0xABC` or `import "path"`
      [/(import)(\s+)([A-Za-z_]\w*)(\s+)(from)(\s+)(0x[0-9a-fA-F]+)/, ['keyword', '', 'type', '', 'keyword', '', 'number.hex']],
      [/(import)(\s+)([A-Za-z_]\w*)(\s+)(from)(\s+)("[^"]*")/, ['keyword', '', 'type', '', 'keyword', '', 'string']],
      [/(import)(\s+)([A-Za-z_]\w*)/, ['keyword', '', 'type']],

      // Function call after dot: `.withdraw(`, `.deposit(`
      [/(\.)([a-zA-Z_]\w*)(\s*\()/, ['delimiter', 'function', 'delimiter']],

      // Property/field access after dot: `.storagePath`, `.name`
      [/(\.)([a-zA-Z_]\w*)/, ['delimiter', 'variable.property']],

      // Argument labels: `amount:`, `from:`, `forPath:`
      [/\b([a-zA-Z_]\w*)\s*(?=:\s*[^:])/, {
        cases: {
          '@typeKeywords': 'type',
          '@keywords': 'keyword',
          '@default': 'parameter',
        },
      }],

      // Function declarations: `fun withdraw(`
      [/(fun)(\s+)([a-zA-Z_]\w*)/, ['keyword', '', 'function']],

      // Type-like identifiers (start with uppercase)
      [/\b[A-Z]\w*/, {
        cases: {
          '@typeKeywords': 'type',
          '@keywords': 'keyword',
          '@default': 'type.identifier',
        },
      }],

      // Identifiers and keywords
      [/\b[a-z_]\w*\b/, {
        cases: {
          '@typeKeywords': 'type',
          '@keywords': 'keyword',
          '@default': 'identifier',
        },
      }],

      // Delimiters
      [/[{}()\[\]]/, '@brackets'],

      // Operators (multi-char first, then single-char)
      [/<->|<-!|<-|->|==|!=|>=|<=|&&|\|\||[?]{2}|<<|>>|\+=|-=|\*=|\/=|%=/, 'operator'],
      [/[+\-*/%&|^~!=<>?:]/, 'operator'],

      // Semicolons, commas, dots
      [/[;,.]/, 'delimiter'],

      // Numbers
      [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
      [/0[bB][01_]+/, 'number.binary'],
      [/0[oO][0-7_]+/, 'number.octal'],
      [/\d[\d_]*\.\d[\d_]*/, 'number.float'],
      [/\d[\d_]*/, 'number'],

      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string'],

      // Decorators / attributes
      [/@[a-zA-Z_]\w*/, 'annotation'],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],

    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],

    string: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],
  },
};

export function registerCadenceLanguage(monaco: typeof import('monaco-editor')) {
  if (!monaco.languages.getLanguages().some((l) => l.id === CADENCE_LANGUAGE_ID)) {
    monaco.languages.register({ id: CADENCE_LANGUAGE_ID });
  }
  monaco.languages.setLanguageConfiguration(CADENCE_LANGUAGE_ID, cadenceLanguageConfig);
  monaco.languages.setMonarchTokensProvider(CADENCE_LANGUAGE_ID, cadenceTokenProvider);
}
