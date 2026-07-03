// ════════════════════════════════════════════════════════════════
// Server-side proxy за публикуване на fixtures в Oracle
// (xgpro_fixtures_public) — server-to-server заявки НЕ подлежат на
// browser CORS политики, за разлика от директния fetch от клиента,
// който гърмеше с "Failed to fetch" заради Oracle CORS конфигурация.
// ════════════════════════════════════════════════════════════════
const ORACLE_BASE =
  "https://gb975ca8378ff79-home.adb.eu-turin-1.oraclecloudapps.com/ords/admin";
const TABLE = "xgpro_fixtures_public";

async function oraFetch(path, method, body) {
  const url = ORACLE_BASE + path;
  const res = await fetch(url, {
    method: method || "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  return { ok: res.ok, status: res.status, text, json };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      res.status(200).json({ ok: true, count: 0, errors: [] });
      return;
    }

    // ── Cleanup: изтрити expired редове (best-effort, не блокира) ──
    try {
      const nowIso = new Date().toISOString();
      const q = encodeURIComponent(JSON.stringify({ expires_at: { "$lt": nowIso } }));
      const expd = await oraFetch(`/${TABLE}/?q=${q}&fields=id&limit=500`, "GET");
      const items = expd.json?.items || [];
      for (const it of items) {
        await oraFetch(`/${TABLE}/${it.id}`, "DELETE");
      }
    } catch (e) { /* swallow cleanup errors */ }

    // ── Upsert всеки ред (GET по fixture_id → PUT или POST) ──
    let okCount = 0;
    const errors = [];
    for (const row of rows) {
      try {
        const q = encodeURIComponent(JSON.stringify({ fixture_id: row.fixture_id }));
        const existing = await oraFetch(`/${TABLE}/?q=${q}`, "GET");
        const items = existing.json?.items || [];

        if (items.length > 0) {
          const updRow = { ...row };
          delete updRow.created_at;
          delete updRow.expires_at;
          const putId = items[0].id != null ? items[0].id : items[0].fixture_id;
          const r = await oraFetch(`/${TABLE}/${putId}`, "PUT", updRow);
          if (r.ok) okCount++;
          else errors.push(`${row.fixture_id}: HTTP ${r.status} (PUT id=${putId}) rowKeys=[${Object.keys(items[0]).join(',')}] ${r.text.slice(0, 200)}`);
        } else {
          const r = await oraFetch(`/${TABLE}/`, "POST", row);
          if (r.ok) okCount++;
          else errors.push(`${row.fixture_id}: HTTP ${r.status} (POST) ${r.text.slice(0, 150)}`);
        }
      } catch (e) {
        errors.push(`${row.fixture_id}: ${e.message}`);
      }
    }

    res.status(200).json({ ok: okCount > 0, count: okCount, total: rows.length, errors });
  } catch (e) {
    res.status(502).json({ ok: false, error: "proxy_failed", message: String(e?.message || e) });
  }
}
