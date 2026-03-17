import type { languages } from 'monaco-editor';

export const SOLIDITY_LANGUAGE_ID = 'sol';

export function registerSolidityLanguage(monaco: typeof import('monaco-editor')) {
  // Only register once
  if (monaco.languages.getLanguages().some(l => l.id === SOLIDITY_LANGUAGE_ID)) return;

  monaco.languages.register({
    id: SOLIDITY_LANGUAGE_ID,
    extensions: ['.sol'],
    aliases: ['Solidity', 'solidity', 'sol'],
  });

  monaco.languages.setMonarchTokensProvider(SOLIDITY_LANGUAGE_ID, solidityTokens);
}

const solidityTokens: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.sol',

  keywords: [
    'pragma', 'solidity', 'import', 'as', 'from',
    'contract', 'interface', 'library', 'abstract', 'is',
    'function', 'modifier', 'event', 'error', 'struct', 'enum', 'type',
    'constructor', 'fallback', 'receive',
    'public', 'private', 'internal', 'external',
    'pure', 'view', 'payable', 'nonpayable',
    'virtual', 'override', 'immutable', 'constant',
    'storage', 'memory', 'calldata',
    'returns', 'return',
    'if', 'else', 'for', 'while', 'do', 'break', 'continue',
    'try', 'catch', 'revert', 'require', 'assert',
    'emit', 'new', 'delete',
    'mapping', 'using',
    'assembly', 'let',
    'true', 'false',
    'this', 'super',
    'unchecked',
  ],

  typeKeywords: [
    'address', 'bool', 'string', 'bytes',
    'uint', 'int', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
    'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
    'bytes1', 'bytes2', 'bytes3', 'bytes4', 'bytes8', 'bytes16', 'bytes20', 'bytes32',
    'fixed', 'ufixed',
  ],

  operators: [
    '=', '>', '<', '!', '~', '?', ':',
    '==', '<=', '>=', '!=', '&&', '||',
    '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
    '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=',
    '^=', '%=', '<<=', '>>=', '>>>=', '=>',
  ],

  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  digits: /\d+(_+\d+)*/,
  hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,

  tokenizer: {
    root: [
      // Identifiers and keywords
      [/[a-zA-Z_$][\w$]*/, {
        cases: {
          '@typeKeywords': 'type',
          '@keywords': 'keyword',
          '@default': 'identifier',
        },
      }],

      // Whitespace
      { include: '@whitespace' },

      // Delimiters and operators — match multi-char operators like => before single chars
      [/[{}()\[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': '',
        },
      }],

      // Numbers
      [/0[xX]@hexdigits/, 'number.hex'],
      [/@digits[eE][\-+]?@digits/, 'number.float'],
      [/@digits\.@digits([eE][\-+]?@digits)?/, 'number.float'],
      [/@digits/, 'number'],

      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'], // unterminated
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],

    comment: [
      [/[^\/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[\/*]/, 'comment'],
    ],

    string_double: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],

    string_single: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop'],
    ],
  },
};
