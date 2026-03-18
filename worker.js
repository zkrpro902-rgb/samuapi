// ══════════════════════════════════════════════
//  SAMU HQ — Cloudflare Worker API
//  KV Bindings requis : SAMU_KV
//  Variables d'env : API_SECRET
// ══════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

// ─── AUTH BOT ───
function verifyBot(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  return token === env.API_SECRET;
}

// ─── KV HELPERS ───
async function kvGet(env, key) {
  const val = await env.SAMU_KV.get(key);
  return val ? JSON.parse(val) : [];
}

async function kvSet(env, key, data) {
  await env.SAMU_KV.put(key, JSON.stringify(data));
}

async function kvGetObj(env, key) {
  const val = await env.SAMU_KV.get(key);
  return val ? JSON.parse(val) : {};
}

// ─── NEXT ID ───
function nextId(list) {
  return list.length === 0 ? 1 : Math.max(...list.map(x => x.id || 0)) + 1;
}

// ─── PASSWORD GENERATOR ───
function genPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let pwd = "";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) pwd += chars[arr[i] % chars.length];
  return pwd;
}

function genUsername(name) {
  const clean = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
  const num = Math.floor(Math.random() * 900) + 100;
  return clean + num;
}

// ══════════════════════════════════════════════
//  ROUTER PRINCIPAL
// ══════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── ROOT ──
    if (path === "/" && method === "GET") {
      return json({ message: "SAMU HQ API en ligne 🚑", version: "1.0.0" });
    }

    // ════════════════════════════════
    //  AUTH SITE — POST /auth/login
    // ════════════════════════════════
    if (path === "/auth/login" && method === "POST") {
      const body = await request.json();
      const creds = await kvGetObj(env, "credentials");

      // Compte admin par défaut si vide
      if (Object.keys(creds).length === 0) {
        creds["admin"] = { username: "admin", password: "samu2024", role: "admin", discord_id: null };
        await env.SAMU_KV.put("credentials", JSON.stringify(creds));
      }

      const user = creds[body.username];
      if (!user || user.password !== body.password) {
        return err("Identifiants incorrects", 401);
      }
      return json({ success: true, username: body.username, role: user.role || "membre", discord_id: user.discord_id });
    }

    // ════════════════════════════════
    //  CREDENTIALS
    // ════════════════════════════════
    if (path === "/credentials/generate" && method === "POST") {
      if (!verifyBot(request, env)) return err("Non autorisé", 401);
      const body = await request.json();
      const creds = await kvGetObj(env, "credentials");

      const username = genUsername(body.discord_name);
      const password = genPassword();

      creds[username] = {
        username,
        password,
        role: "membre",
        discord_id: body.discord_id,
        discord_name: body.discord_name,
        created_by: body.created_by,
        created_at: new Date().toISOString(),
      };
      await kvSet(env, "credentials", creds);
      return json({ username, password });
    }

    if (path === "/credentials/reset" && method === "POST") {
      if (!verifyBot(request, env)) return err("Non autorisé", 401);
      const body = await request.json();
      const creds = await kvGetObj(env, "credentials");

      const entry = Object.values(creds).find(v => v.discord_id === body.discord_id);
      if (!entry) return err("Membre introuvable", 404);

      const newPassword = genPassword();
      entry.password = newPassword;
      entry.reset_at = new Date().toISOString();
      entry.reset_by = body.reset_by;
      await kvSet(env, "credentials", creds);
      return json({ username: entry.username, password: newPassword });
    }

    if (path.startsWith("/credentials/get/") && method === "GET") {
      if (!verifyBot(request, env)) return err("Non autorisé", 401);
      const discordId = path.split("/").pop();
      const creds = await kvGetObj(env, "credentials");
      const entry = Object.values(creds).find(v => v.discord_id === discordId);
      if (!entry) return err("Introuvable", 404);
      return json(entry);
    }

    // ════════════════════════════════
    //  RAPPORTS
    // ════════════════════════════════
    if (path === "/rapports") {
      if (method === "GET") {
        return json(await kvGet(env, "rapports"));
      }
      if (method === "POST") {
        if (!verifyBot(request, env)) return err("Non autorisé", 401);
        const body = await request.json();
        const list = await kvGet(env, "rapports");
        const entry = { ...body, id: nextId(list), date: new Date().toISOString() };
        list.push(entry);
        await kvSet(env, "rapports", list);
        return json(entry);
      }
    }

    // DELETE /rapports/:id
    const rapportMatch = path.match(/^\/rapports\/(\d+)$/);
    if (rapportMatch && method === "DELETE") {
      const id = parseInt(rapportMatch[1]);
      const list = (await kvGet(env, "rapports")).filter(x => x.id !== id);
      await kvSet(env, "rapports", list);
      return json({ deleted: id });
    }

    // ════════════════════════════════
    //  PATIENTS
    // ════════════════════════════════
    if (path === "/patients") {
      if (method === "GET") return json(await kvGet(env, "patients"));
      if (method === "POST") {
        const body = await request.json();
        const list = await kvGet(env, "patients");
        const entry = { ...body, id: nextId(list), date: new Date().toISOString() };
        list.push(entry);
        await kvSet(env, "patients", list);
        return json(entry);
      }
    }

    const patientMatch = path.match(/^\/patients\/(\d+)(\/statut)?$/);
    if (patientMatch) {
      const id = parseInt(patientMatch[1]);
      if (method === "DELETE") {
        const list = (await kvGet(env, "patients")).filter(x => x.id !== id);
        await kvSet(env, "patients", list);
        return json({ deleted: id });
      }
      if (method === "PUT" && patientMatch[2]) {
        const body = await request.json();
        const list = await kvGet(env, "patients");
        const p = list.find(x => x.id === id);
        if (p) p.statut = body.statut;
        await kvSet(env, "patients", list);
        return json({ updated: id });
      }
    }

    // ════════════════════════════════
    //  SERVICES
    // ════════════════════════════════
    if (path === "/services") {
      if (method === "GET") return json(await kvGet(env, "services"));
      if (method === "POST") {
        if (!verifyBot(request, env)) return err("Non autorisé", 401);
        const body = await request.json();
        const list = await kvGet(env, "services");
        const entry = { ...body, id: nextId(list) };
        list.push(entry);
        await kvSet(env, "services", list);
        return json(entry);
      }
    }

    const serviceMatch = path.match(/^\/services\/(\d+)(\/fin)?$/);
    if (serviceMatch) {
      const id = parseInt(serviceMatch[1]);
      if (method === "DELETE") {
        const list = (await kvGet(env, "services")).filter(x => x.id !== id);
        await kvSet(env, "services", list);
        return json({ deleted: id });
      }
      if (method === "PUT" && serviceMatch[2]) {
        if (!verifyBot(request, env)) return err("Non autorisé", 401);
        const list = await kvGet(env, "services");
        const s = list.find(x => x.id === id);
        if (s) s.fin = new Date().toISOString();
        await kvSet(env, "services", list);
        return json({ updated: id });
      }
    }

    // ════════════════════════════════
    //  MEMBRES
    // ════════════════════════════════
    if (path === "/membres") {
      if (method === "GET") return json(await kvGet(env, "membres"));
      if (method === "POST") {
        const body = await request.json();
        const list = await kvGet(env, "membres");
        const entry = { ...body, id: nextId(list), services: 0, warns: 0 };
        list.push(entry);
        await kvSet(env, "membres", list);
        return json(entry);
      }
    }

    const membreMatch = path.match(/^\/membres\/(\d+)(\/warn)?$/);
    if (membreMatch) {
      const id = parseInt(membreMatch[1]);
      if (method === "DELETE") {
        const list = (await kvGet(env, "membres")).filter(x => x.id !== id);
        await kvSet(env, "membres", list);
        return json({ deleted: id });
      }
      if (method === "PUT" && membreMatch[2]) {
        const list = await kvGet(env, "membres");
        const m = list.find(x => x.id === id);
        if (m) m.warns = (m.warns || 0) + 1;
        await kvSet(env, "membres", list);
        return json({ updated: id });
      }
    }

    // ════════════════════════════════
    //  STATS
    // ════════════════════════════════
    if (path === "/stats" && method === "GET") {
      const [rapports, patients, services, membres] = await Promise.all([
        kvGet(env, "rapports"),
        kvGet(env, "patients"),
        kvGet(env, "services"),
        kvGet(env, "membres"),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      return json({
        total_rapports: rapports.length,
        rapports_today: rapports.filter(r => r.date?.startsWith(today)).length,
        patients_actifs: patients.filter(p => p.statut === "en_cours").length,
        total_membres: membres.length,
        total_services: services.length,
      });
    }

    return err("Route introuvable", 404);
  },
};
