import { ASSETS, sendError, sendJson } from "../lib/security.js";

export default function handler(req, res) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed.");
  return sendJson(res, 200, ASSETS.map(({ id, label, filename, size }) => ({
    id, label, filename, size
  })));
}
