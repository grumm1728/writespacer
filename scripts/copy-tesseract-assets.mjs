import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "tesseract");
const coreOutput = path.join(output, "core");
const langOutput = path.join(output, "lang");

await Promise.all([
  mkdir(coreOutput, { recursive: true }),
  mkdir(langOutput, { recursive: true }),
]);

await Promise.all([
  copy("node_modules/tesseract.js/dist/worker.min.js", "public/tesseract/worker.min.js"),
  copy(
    "node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt",
    "public/tesseract/worker.min.js.LICENSE.txt",
  ),
  copy("node_modules/tesseract.js-core/LICENSE", "public/tesseract/core/LICENSE"),
  copy(
    "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
    "public/tesseract/core/tesseract-core-lstm.wasm.js",
  ),
  copy(
    "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    "public/tesseract/core/tesseract-core-simd-lstm.wasm.js",
  ),
  copy(
    "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
    "public/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js",
  ),
  copy(
    "node_modules/tesseract.js-core/tesseract-core.wasm.js",
    "public/tesseract/core/tesseract-core.wasm.js",
  ),
  copy(
    "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "public/tesseract/lang/eng.traineddata.gz",
  ),
]);

async function copy(source, destination) {
  await copyFile(path.join(root, source), path.join(root, destination));
}
