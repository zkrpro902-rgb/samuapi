// ══════════════════════════════════════════════
//  SAMU HQ — Cloudflare Worker API (D1 SQL)
//  D1 Binding : SAMU_DB
//  Variables d’env : API_SECRET
// ══════════════════════════════════════════════

const CORS = {
“Access-Control-Allow-Origin”: “*”,
“Access-Control-Allow-Methods”: “GET, POST, PUT, DELETE, OPTIONS”,
“Access-Control-Allow-Headers”: “Content-Type, Authorization”,
};

function json(data, status = 200) {
return new Response(JSON.stringify(data), {
status,
headers: { …CORS, “Content-Type”: “application/json” },
});
}

function err(msg, status = 400) {
return json({ error: msg }, status);
}

function verifyBot(request, env) {
const auth = request.headers.get(“Authorization”) || “”;
return auth.replace(“Bearer “, “”).trim() === env.API_SECRET;
}

function genPassword(length = 10) {
const chars = “ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%”;
let pwd = “”;
const arr = new Uint8Array(length);
crypto.getRandomValues(arr);
for (let i = 0; i < length; i++) pwd += chars[arr[i] % chars.length];
return pwd;
}

function genUsername(name) {
const clean = name.replace(/[^a-zA-Z0-9]/g, “”).slice(0, 8).toLowerCase();
return clean + (Math.floor(Math.random() * 900) + 100);
}

async function initDB(db) {
await db.prepare(`CREATE TABLE IF NOT EXISTS credentials ( username TEXT PRIMARY KEY, password TEXT NOT NULL, role TEXT DEFAULT 'membre', discord_id TEXT, discord_name TEXT, created_by TEXT, created_at TEXT )`).run();

await db.prepare(`CREATE TABLE IF NOT EXISTS rapports ( id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, lieu TEXT, auteur TEXT, membres TEXT, gravite TEXT, statut TEXT, description TEXT, discord_id TEXT, date TEXT )`).run();

await db.prepare(`CREATE TABLE IF NOT EXISTS patients ( id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT, motif TEXT, gravite TEXT, medecin TEXT, statut TEXT, notes TEXT, date TEXT )`).run();

await db.prepare(`CREATE TABLE IF NOT EXISTS services ( id INTEGER PRIMARY KEY AUTOINCREMENT, membre TEXT, grade TEXT, debut TEXT, fin TEXT, discord_id TEXT )`).run();

await db.prepare(`CREATE TABLE IF NOT EXISTS membres ( id INTEGER PRIMARY KEY AUTOINCREMENT, pseudo TEXT, grade TEXT, statut TEXT, discord_id TEXT, services INTEGER DEFAULT 0, warns INTEGER DEFAULT 0 )`).run();

await db.prepare(`INSERT OR IGNORE INTO credentials (username, password, role, discord_id) VALUES ('admin', 'samu2024', 'admin', NULL)`).run();
}

export default {
async fetch(request, env) {
const url = new URL(request.url);
const path = url.pathname;
const method = request.method;

```
if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

try {
  await initDB(env.SAMU_DB);
} catch(e) {
  return err("DB init error: " + e.message, 500);
}

if (path === "/" && method === "GET") {
  return json({ message: "SAMU HQ API en ligne 🚑 (D1)", version: "2.0.0" });
}

// ════════════════════════════════
//  AUTH
// ════════════════════════════════
if (path === "/auth/login" && method === "POST") {
  const body = await request.json();
  const user = await env.SAMU_DB.prepare(
    "SELECT * FROM credentials WHERE username = ? AND password = ?"
  ).bind(body.username, body.password).first();
  if (!user) return err("Identifiants incorrects", 401);
  return json({ success: true, username: user.username, role: user.role, discord_id: user.discord_id });
}

// ════════════════════════════════
//  CREDENTIALS
// ════════════════════════════════
if (path === "/credentials/generate" && method === "POST") {
  if (!verifyBot(request, env)) return err("Non autorisé", 401);
  const body = await request.json();
  const username = genUsername(body.discord_name);
  const password = genPassword();
  await env.SAMU_DB.prepare(
    "INSERT OR REPLACE INTO credentials (username, password, role, discord_id, discord_name, created_by, created_at) VALUES (?, ?, 'membre', ?, ?, ?, ?)"
  ).bind(username, password, body.discord_id, body.discord_name, body.created_by, new Date().toISOString()).run();
  return json({ username, password });
}

if (path === "/credentials/reset" && method === "POST") {
  if (!verifyBot(request, env)) return err("Non autorisé", 401);
  const body = await request.json();
  const user = await env.SAMU_DB.prepare(
    "SELECT * FROM credentials WHERE discord_id = ?"
  ).bind(body.discord_id).first();
  if (!user) return err("Membre introuvable", 404);
  const newPassword = genPassword();
  await env.SAMU_DB.prepare(
    "UPDATE credentials SET password = ? WHERE discord_id = ?"
  ).bind(newPassword, body.discord_id).run();
  return json({ username: user.username, password: newPassword });
}

if (path.startsWith("/credentials/get/") && method === "GET") {
  if (!verifyBot(request, env)) return err("Non autorisé", 401);
  const discordId = path.split("/").pop();
  const user = await env.SAMU_DB.prepare(
    "SELECT * FROM credentials WHERE discord_id = ?"
  ).bind(discordId).first();
  if (!user) return err("Introuvable", 404);
  return json(user);
}

// ════════════════════════════════
//  RAPPORTS
// ════════════════════════════════
if (path === "/rapports") {
  if (method === "GET") {
    const { results } = await env.SAMU_DB.prepare("SELECT * FROM rapports ORDER BY id DESC").all();
    return json(results);
  }
  if (method === "POST") {
    const b = await request.json();
    const result = await env.SAMU_DB.prepare(
      "INSERT INTO rapports (type, lieu, auteur, membres, gravite, statut, description, discord_id, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(b.type||"", b.lieu||"", b.auteur||"", b.membres||"", b.gravite||"", b.statut||"", b.desc||"", b.discord_id||null, new Date().toISOString()).run();
    return json({ id: result.meta.last_row_id, ...b });
  }
}

const rapportMatch = path.match(/^\/rapports\/(\d+)$/);
if (rapportMatch && method === "DELETE") {
  await env.SAMU_DB.prepare("DELETE FROM rapports WHERE id = ?").bind(parseInt(rapportMatch[1])).run();
  return json({ deleted: parseInt(rapportMatch[1]) });
}

// ════════════════════════════════
//  PATIENTS
// ════════════════════════════════
if (path === "/patients") {
  if (method === "GET") {
    const { results } = await env.SAMU_DB.prepare("SELECT * FROM patients ORDER BY id DESC").all();
    return json(results);
  }
  if (method === "POST") {
    const b = await request.json();
    const result = await env.SAMU_DB.prepare(
      "INSERT INTO patients (nom, motif, gravite, medecin, statut, notes, date) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(b.nom||"", b.motif||"", b.gravite||"", b.medecin||"", b.statut||"", b.notes||"", new Date().toISOString()).run();
    return json({ id: result.meta.last_row_id, ...b });
  }
}

const patientMatch = path.match(/^\/patients\/(\d+)(\/statut)?$/);
if (patientMatch) {
  const id = parseInt(patientMatch[1]);
  if (method === "DELETE") {
    await env.SAMU_DB.prepare("DELETE FROM patients WHERE id = ?").bind(id).run();
    return json({ deleted: id });
  }
  if (method === "PUT" && patientMatch[2]) {
    const b = await request.json();
    await env.SAMU_DB.prepare("UPDATE patients SET statut = ? WHERE id = ?").bind(b.statut, id).run();
    return json({ updated: id });
  }
}

// ════════════════════════════════
//  SERVICES
// ════════════════════════════════
if (path === "/services") {
  if (method === "GET") {
    const { results } = await env.SAMU_DB.prepare("SELECT * FROM services ORDER BY id DESC").all();
    return json(results);
  }
  if (method === "POST") {
    const b = await request.json();
    const result = await env.SAMU_DB.prepare(
      "INSERT INTO services (membre, grade, debut, fin, discord_id) VALUES (?, ?, ?, ?, ?)"
    ).bind(b.membre||"", b.grade||"", b.debut||new Date().toISOString(), b.fin||null, b.discord_id||null).run();
    return json({ id: result.meta.last_row_id, ...b });
  }
}

const serviceMatch = path.match(/^\/services\/(\d+)(\/fin)?$/);
if (serviceMatch) {
  const id = parseInt(serviceMatch[1]);
  if (method === "DELETE") {
    await env.SAMU_DB.prepare("DELETE FROM services WHERE id = ?").bind(id).run();
    return json({ deleted: id });
  }
  if (method === "PUT" && serviceMatch[2]) {
    await env.SAMU_DB.prepare("UPDATE services SET fin = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    return json({ updated: id });
  }
}

// ════════════════════════════════
//  MEMBRES
// ════════════════════════════════
if (path === "/membres") {
  if (method === "GET") {
    const { results } = await env.SAMU_DB.prepare("SELECT * FROM membres ORDER BY id DESC").all();
    return json(results);
  }
  if (method === "POST") {
    const b = await request.json();
    const result = await env.SAMU_DB.prepare(
      "INSERT INTO membres (pseudo, grade, statut, discord_id, services, warns) VALUES (?, ?, ?, ?, 0, 0)"
    ).bind(b.pseudo||"", b.grade||"", b.statut||"actif", b.discord_id||null).run();
    return json({ id: result.meta.last_row_id, ...b });
  }
}

const membreMatch = path.match(/^\/membres\/(\d+)(\/warn)?$/);
if (membreMatch) {
  const id = parseInt(membreMatch[1]);
  if (method === "DELETE") {
    await env.SAMU_DB.prepare("DELETE FROM membres WHERE id = ?").bind(id).run();
    return json({ deleted: id });
  }
  if (method === "PUT" && membreMatch[2]) {
    await env.SAMU_DB.prepare("UPDATE membres SET warns = warns + 1 WHERE id = ?").bind(id).run();
    return json({ updated: id });
  }
}

// ════════════════════════════════
//  STATS
// ════════════════════════════════
if (path === "/stats" && method === "GET") {
  const today = new Date().toISOString().slice(0, 10);
  const [totalR, todayR, activePat, totalM, totalS] = await Promise.all([
    env.SAMU_DB.prepare("SELECT COUNT(*) as c FROM rapports").first(),
    env.SAMU_DB.prepare("SELECT COUNT(*) as c FROM rapports WHERE date LIKE ?").bind(`${today}%`).first(),
    env.SAMU_DB.prepare("SELECT COUNT(*) as c FROM patients WHERE statut = 'en_cours'").first(),
    env.SAMU_DB.prepare("SELECT COUNT(*) as c FROM membres").first(),
    env.SAMU_DB.prepare("SELECT COUNT(*) as c FROM services").first(),
  ]);
  return json({
    total_rapports: totalR.c,
    rapports_today: todayR.c,
    patients_actifs: activePat.c,
    total_membres: totalM.c,
    total_services: totalS.c,
  });
}

return err("Route introuvable", 404);
```

},
};
