import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { get, put } from "@vercel/blob";
import { Readable } from "node:stream";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(PROJECT_DIR, "..");
const assets = JSON.parse(await fs.readFile(path.join(PROJECT_DIR, "assets.json"), "utf8"));
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is missing. Run 'vercel env pull .env.local' first.");

function gitBlobSha1(bytes) {
  return crypto.createHash("sha1")
    .update(Buffer.from("blob " + bytes.length + "\0", "utf8"))
    .update(bytes)
    .digest("hex");
}

for (const asset of assets) {
  const source = path.join(REPO_ROOT, asset.filename);
  const bytes = await fs.readFile(source);
  const actual = gitBlobSha1(bytes);
  if (bytes.length !== asset.size || actual !== asset.gitBlobSha1) {
    throw new Error("Integrity check failed for " + asset.filename +
      ": size=" + bytes.length + ", gitBlobSha1=" + actual);
  }

  const uploaded = await put(asset.pathname, bytes, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: asset.contentType,
    token
  });
  if (uploaded.pathname !== asset.pathname) {
    throw new Error("Unexpected private Blob pathname for " + asset.filename);
  }

  // Read the private object back through the authenticated SDK and verify the
  // complete stored bytes. This costs one small verification read per asset.
  const stored = await get(asset.pathname, { access: "private", token });
  if (!stored || stored.statusCode !== 200 || !stored.stream) {
    throw new Error("Private Blob read-back failed for " + asset.filename);
  }
  const verifyHash = crypto.createHash("sha1");
  let verifySize = 0;
  for await (const chunk of Readable.fromWeb(stored.stream)) {
    verifyHash.update(chunk);
    verifySize += chunk.length;
  }
  const storedHash = verifyHash.digest("hex");
  if (verifySize !== asset.size || storedHash !== asset.gitBlobSha1) {
    throw new Error("Private Blob integrity check failed for " + asset.filename +
      ": size=" + verifySize + ", gitBlobSha1=" + storedHash);
  }
  console.log("PASS", asset.filename, verifySize, storedHash, "-> private Blob", uploaded.pathname);
}
console.log("All seven existing files were uploaded to private Vercel Blob and verified before upload.");
