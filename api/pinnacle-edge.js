// ════════════════════════════════════════════════════════════════
// CRUD proxy за Pinnacle Edge (xgpro_pinnacle_edge) — GET листва,
// POST добавя (batch — масив от редове наведнъж), PUT обновява
// финалния резултат по id, DELETE трие ред. Server-side, за да
// избегнем директен client→Oracle CORS проблем. Следва ТОЧНО
// същия pattern като /api/value-bet-log.js.
// ════════════════════════════════════════════════════════════════
const ORACLE_BASE =
  "https://gb975ca8378ff79-home.adb.eu-turin-1.oraclecloudapps.com/ords/admin";
const TABLE = "xgpro_pinnacle_edge";

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
  try {
    if (req.method === "GET") {
      const r = await oraFetch(`/${TABLE}/?limit=500&orderBy=created_at:desc`, "GET");
      if (!r.ok) { res.status(200).json({ ok: true, items: [] }); return; }
      res.status(200).json({ ok: true, items: r.json?.items || [] });
      return;
    }

    if (req.method === "POST") {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!rows.length) { res.status(400).json({ ok: false, error: "missing_rows" }); return; }

      // ✅ Дубликат защита — теглим съществуващите сигнали и пропускаме
      // редове, които вече присъстват (същия мач + пазар), вместо да
      // създаваме нов ред при всяко повторно качване на същия файл.
      // ВАЖНО: за "Totals" пазар, Setting (Goals/Corners) СЪЩЕСТВЕНО
      // променя залога (общо ГОЛОВЕ срещу общо КОРНЕРИ над/под същата
      // линия — различни резултати!) — затова се включва в ключа. За
      // "ML" пазар Setting е ирелевантно (краен победител си е един и
      // същ, независимо от таг-а) — НЕ се включва, за да се дедуплицира
      // правилно двойните ML записи, които OddAlerts понякога изпраща.
      const existingResp = await oraFetch(`/${TABLE}/?limit=500`, "GET");
      const existingItems = existingResp.json?.items || [];
      const dupKey = (r) =>
        `${(r.home || "").trim().toLowerCase()}|${(r.away || "").trim().toLowerCase()}|${r.market_label || ""}|${r.market === "Totals" ? (r.setting || "") : ""}`;
      const existingKeys = new Set(existingItems.map(dupKey));

      let count = 0;
      let skipped = 0;
      const errors = [];
      let seq = 0;
      for (const row of rows) {
        if (existingKeys.has(dupKey(row))) { skipped++; continue; }
        existingKeys.add(dupKey(row)); // за да не дублираме и вътре в СЪЩИЯ batch
        // ✅ КРИТИЧНО: id колоната е VARCHAR2 PRIMARY KEY БЕЗ auto-generation
        // (за разлика от value_bet_log, чиято id е auto-increment NUMBER).
        // Без изрична стойност тук всеки INSERT нарушава PRIMARY KEY
        // constraint-а (NULL) → HTTP 400 за буквално всеки ред.
        const id = "pe_" + Date.now() + "_" + (seq++) + "_" + Math.random().toString(36).slice(2, 8);
        const payload = {
          id,
          setting: row.setting || null,
          home: row.home || null,
          away: row.away || null,
          league: row.league || "",
          market: row.market || null,
          market_side: row.market_side || null,
          market_line: row.market_line != null ? row.market_line : null,
          market_label: row.market_label || null,
          fair_price: row.fair_price != null ? row.fair_price : null,
          bet365_odds: row.bet365_odds != null ? row.bet365_odds : null,
          edge_pct: row.edge_pct != null ? row.edge_pct : null,
          implied_prob: row.implied_prob != null ? row.implied_prob : null,
          kickoff_txt: row.kickoff_txt || null,
          kickoff_date_iso: row.kickoff_date_iso || null,
          final_score_home: null,
          final_score_away: null,
          final_corners_home: null,
          final_corners_away: null,
          created_at: new Date().toISOString(),
        };
        const r = await oraFetch(`/${TABLE}/`, "POST", payload);
        if (r.ok) count++;
        else errors.push(`${row.home} vs ${row.away}: HTTP ${r.status} ${r.text.slice(0, 150)}`);
      }
      res.status(200).json({ ok: count > 0 || skipped > 0, count, skipped, total: rows.length, errors });
      return;
    }

    if (req.method === "PUT") {
      const {
        id, final_score_home, final_score_away, final_corners_home, final_corners_away,
        // ✅ Редактиране на основните полета на сигнала (не само резултата) —
        // за бутона "✏️ Редактирай" в UI-то.
        home, away, league, setting, market, market_side, market_line, market_label,
        fair_price, bet365_odds, edge_pct, implied_prob, kickoff_txt,
      } = req.body || {};
      if (!id) { res.status(400).json({ ok: false, error: "missing_id" }); return; }

      // ✅ ORDS връща HTTP 405 на PATCH за тези таблици — GET + пълен
      // PUT вместо частичен PATCH (същия pattern като value-bet-log).
      const existing = await oraFetch(`/${TABLE}/${id}`, "GET");
      if (!existing.ok || !existing.json) {
        res.status(200).json({ ok: false, error: `Не намерих запис ${id}: HTTP ${existing.status}` });
        return;
      }
      const full = { ...existing.json };
      delete full.links; delete full._links;
      if (final_score_home !== undefined) full.final_score_home = final_score_home;
      if (final_score_away !== undefined) full.final_score_away = final_score_away;
      if (final_corners_home !== undefined) full.final_corners_home = final_corners_home;
      if (final_corners_away !== undefined) full.final_corners_away = final_corners_away;
      if (home !== undefined) full.home = home;
      if (away !== undefined) full.away = away;
      if (league !== undefined) full.league = league;
      if (setting !== undefined) full.setting = setting;
      if (market !== undefined) full.market = market;
      if (market_side !== undefined) full.market_side = market_side;
      if (market_line !== undefined) full.market_line = market_line;
      if (market_label !== undefined) full.market_label = market_label;
      if (fair_price !== undefined) full.fair_price = fair_price;
      if (bet365_odds !== undefined) full.bet365_odds = bet365_odds;
      if (edge_pct !== undefined) full.edge_pct = edge_pct;
      if (implied_prob !== undefined) full.implied_prob = implied_prob;
      if (kickoff_txt !== undefined) full.kickoff_txt = kickoff_txt;

      const r = await oraFetch(`/${TABLE}/${id}`, "PUT", full);
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};
      if (!id) { res.status(400).json({ ok: false, error: "missing_id" }); return; }
      const r = await oraFetch(`/${TABLE}/${id}`, "DELETE");
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
