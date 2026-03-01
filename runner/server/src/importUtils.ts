/** Detect if code has address imports like `import X from 0xabc123` */
export function hasAddressImports(code: string): boolean {
  return /import\s+\w[\w, ]*\s+from\s+0x[0-9a-fA-F]+/m.test(code);
}

/**
 * Extract address imports, supporting both single and multi-name forms:
 *   `import FungibleToken from 0xf233dcee88fe0abe`
 *   `import TopShotMarketV3, Market from 0xc1e4f4f4c4257510`
 */
export function extractAddressImports(code: string): { name: string; address: string }[] {
  const imports: { name: string; address: string }[] = [];
  const re = /import\s+([\w][\w, ]*\w)\s+from\s+0x([0-9a-fA-F]+)/gm;
  let m;
  while ((m = re.exec(code)) !== null) {
    const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
    const address = m[2];
    for (const name of names) {
      imports.push({ name, address });
    }
  }
  return imports;
}

/**
 * Rewrite address imports to string imports:
 *   `import X from 0xAddr` -> `import "X"`
 *   `import X, Y from 0xAddr` -> `import "X"\nimport "Y"`
 */
export function rewriteToStringImports(code: string): string {
  return code.replace(
    /import\s+([\w][\w, ]*\w)\s+from\s+0x[0-9a-fA-F]+/gm,
    (_match, namesPart: string) => {
      const names = namesPart.split(',').map((n) => n.trim()).filter(Boolean);
      return names.map((n) => `import "${n}"`).join('\n');
    },
  );
}
