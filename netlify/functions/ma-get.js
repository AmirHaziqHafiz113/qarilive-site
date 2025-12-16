import { getStore } from "@netlify/blobs";

export default async (request) => {
  try {
    const url = new URL(request.url);
    const ref = (url.searchParams.get("ref") || "").trim();

    if (!ref) {
      return Response.json({ ok: false, error: "Missing ref" }, { status: 400 });
    }

    // Store name: master_agents (you will save data with key = ref)
    const store = getStore("master_agents");

    const data = await store.get(ref, { type: "json" });

    if (!data) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data }, { status: 200 });
  } catch (e) {
    return Response.json(
      { ok: false, error: "Server error", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
};
