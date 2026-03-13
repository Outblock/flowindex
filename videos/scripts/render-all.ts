import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const products = ["explorer", "simulator", "devportal"];
const templates = ["intro"];
const formats = ["portrait", "square", "landscape"];

mkdirSync(join(root, "out"), { recursive: true });

for (const product of products) {
  for (const template of templates) {
    for (const format of formats) {
      const id = `${product}-${template}-${format}`;
      const outPath = join(root, "out", `${id}.mp4`);
      console.log(`\nRendering ${id}...`);
      try {
        execSync(`bunx remotion render ${id} --output ${outPath}`, {
          stdio: "inherit",
          cwd: root,
        });
        console.log(`Done: ${outPath}`);
      } catch {
        console.error(`Failed: ${id}`);
      }
    }
  }
}

console.log("\nAll renders complete.");
