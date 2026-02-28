export interface CodeSnippetLine {
  lineNum: number;
  code: string;
  isError: boolean; // true for ^^^^ lines or the line they point to
}

export interface CallStackEntry {
  location: string; // e.g. "e467b9dd11fa00df.EVM"
  line: number;
  col: number;
}

export interface ParsedCadenceError {
  errorCode: string | null;
  summary: string;
  codeSnippet: CodeSnippetLine[] | null;
  callStack: CallStackEntry[];
  scriptErrorLine: number | null;
  hint: string | null;
}

/**
 * Parse a raw Cadence runtime error string into structured components.
 *
 * Cadence errors look like:
 *   [Error Code: 1101] error caused by: ... cadence runtime error: Execution failed:
 *   --> <address>:<line>:<col>
 *   |
 *   | <line_num> | <code_line>
 *   | <line_num> | <code_line>
 *   |            ^^^^^^^^^^^^^^^^
 *   --> <contract>:<line>:<col>
 *   error: <human-readable message>
 *   --> <contract>:<line>:<col>
 */
export function parseCadenceError(raw: string): ParsedCadenceError {
  // Extract error code
  const codeMatch = raw.match(/\[Error Code:\s*(\d+)\]/);
  const errorCode = codeMatch ? codeMatch[1] : null;

  // Extract the human-readable summary from "error: <message>" lines
  // Look for lines starting with "error: " that contain the actual message
  const errorLines = raw.match(/^error:\s*(.+?)(?:\n|$)/gm);
  let summary = '';
  if (errorLines && errorLines.length > 0) {
    // Take the last "error:" line as it's usually the most specific
    summary = errorLines[errorLines.length - 1].replace(/^error:\s*/, '').trim();
  }

  // If no "error:" line, try to extract from "Execution failed:" context
  if (!summary) {
    const execMatch = raw.match(/Execution failed:\s*(.+?)(?:\n|$)/);
    if (execMatch) {
      summary = execMatch[1].trim();
    }
  }

  // If still nothing, use a cleaned-up version of the raw text
  if (!summary) {
    // Strip the error code prefix and take first meaningful line
    summary = raw
      .replace(/\[Error Code:\s*\d+\]\s*/g, '')
      .replace(/error caused by:.*?cadence runtime error:\s*/s, '')
      .split('\n')[0]
      .trim();
  }

  // Parse code snippet lines: "| <num> | <code>" or "|   ^^^^"
  const snippetLines: CodeSnippetLine[] = [];
  const snippetRegex = /^\s*\|\s*(\d+)\s*\|\s*(.*)$/gm;
  let match: RegExpExecArray | null;
  while ((match = snippetRegex.exec(raw)) !== null) {
    snippetLines.push({
      lineNum: parseInt(match[1], 10),
      code: match[2],
      isError: false,
    });
  }

  // Find ^^^^ lines to mark error positions
  const caretRegex = /^\s*\|\s+\^+/gm;
  const caretPositions: number[] = [];
  while (caretRegex.exec(raw) !== null) {
    // Mark the snippet line just before this caret line as the error
    if (snippetLines.length > 0) {
      caretPositions.push(snippetLines.length - 1);
    }
  }

  // Re-scan to find caret lines that appear after specific code lines
  // by checking position in the raw string
  if (snippetLines.length > 0) {
    const rawLines = raw.split('\n');
    let snippetIdx = 0;
    for (const line of rawLines) {
      if (/^\s*\|\s*\d+\s*\|/.test(line)) {
        snippetIdx++;
      } else if (/^\s*\|\s+\^+/.test(line) && snippetIdx > 0) {
        snippetLines[snippetIdx - 1].isError = true;
      }
    }
  }

  const codeSnippet = snippetLines.length > 0 ? snippetLines : null;

  // Parse call stack: "--> <location>:<line>:<col>"
  const callStack: CallStackEntry[] = [];
  const arrowRegex = /-->\s*([^:\n]+):(\d+):(\d+)/g;
  while ((match = arrowRegex.exec(raw)) !== null) {
    callStack.push({
      location: match[1].trim(),
      line: parseInt(match[2], 10),
      col: parseInt(match[3], 10),
    });
  }

  // The first --> entry that looks like a transaction script reference
  // (no dots = not a contract reference) gives us the script error line.
  // If all entries have dots (contract refs), the first entry's line is used.
  let scriptErrorLine: number | null = null;
  if (callStack.length > 0) {
    const txEntry = callStack.find(e => !e.location.includes('.'));
    scriptErrorLine = txEntry ? txEntry.line : callStack[0].line;
  }

  // Extract hint (trailing "Was this error unhelpful?..." text)
  const hintMatch = raw.match(/(Was this error unhelpful\?.+)$/s);
  const hint = hintMatch ? hintMatch[1].trim() : null;

  return {
    errorCode,
    summary,
    codeSnippet,
    callStack,
    scriptErrorLine,
    hint,
  };
}
