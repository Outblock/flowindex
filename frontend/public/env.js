// This file is intentionally committed with safe defaults so local `bun run dev`
// doesn't 404 on `/env.js`. In Docker/Railway, `frontend/entrypoint.sh` overwrites
// this file using `env.template.js`.
window.__FLOWSCAN_ENV__ = {
  DOCS_URL: "",
};

