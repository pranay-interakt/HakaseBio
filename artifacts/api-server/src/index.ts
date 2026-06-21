import app from "./app";

// Guard against AbortError / DOMException [TimeoutError] from AbortSignal.timeout()
// bubbling up as unhandled rejections in Node 25+ and crashing the process.
// These are expected timeouts from upstream API calls (ChEMBL, UniProt, etc.)
// and are always caught by route try/catch — but Node 25 changed the timing.
process.on("unhandledRejection", (reason: any) => {
  const name = reason?.name ?? reason?.constructor?.name ?? "";
  if (name === "AbortError" || name === "TimeoutError" || name === "DOMException") return;
  console.error("[api-server] unhandledRejection:", reason);
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
