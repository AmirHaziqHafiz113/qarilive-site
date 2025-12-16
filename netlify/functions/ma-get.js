export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const ref = (url.searchParams.get("ref") || "").toString().trim().toUpperCase();
  if (!ref) {
    return new Response(JSON.stringify({ ok: false, error: "Missing ref" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { getStore } = await import("@netlify/blobs");
  const store = getStore("masterAgents");

  const raw = await store.get(ref);
  if (!raw) {
    return new Response(JSON.stringify({ ok: false, error: `Master Agent not found for REF: ${ref}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, data: JSON.parse(raw) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
