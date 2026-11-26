import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

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
  console.log("PASS", asset.filename, bytes.length, actual, "-> private Blob", uploaded.pathname);
}
console.log("All seven existing files were uploaded to private Vercel Blob and verified before upload.");
