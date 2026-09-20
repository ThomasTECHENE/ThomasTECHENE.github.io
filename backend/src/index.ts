export interface Env {
  DB: D1Database;
  EDITOR_ACCESS_CODE: string;
  EDITOR_SESSION_SECRET: string;
  ALLOWED_ORIGIN?: string;
}

type Card = { id: string; title: string; description: string; sortOrder: number };
type Topic = Card & { categoryId: string };
type Input = { title: string; description: string };

const encoder = new TextEncoder();
const defaultCategories: Card[] = [
  { id: "economie", title: "Économie", description: "Comprendre les grandes mécaniques qui façonnent nos choix.", sortOrder: 1 },
  { id: "societe", title: "Société", description: "Idées, institutions et questions qui traversent notre quotidien.", sortOrder: 2 },
  { id: "technologie", title: "Technologie", description: "Des outils qui changent la façon dont nous vivons et travaillons.", sortOrder: 3 },
];
const defaultTopics: Topic[] = [
  { id: "inflation", categoryId: "economie", title: "L’inflation, simplement", description: "Pourquoi les prix montent, comment elle est mesurée, et ce qu’elle change au quotidien.", sortOrder: 1 },
  { id: "offre-demande", categoryId: "economie", title: "L’offre et la demande", description: "Le principe qui aide à lire les prix, les pénuries et les comportements de marché.", sortOrder: 2 },
  { id: "budget-public", categoryId: "economie", title: "Le budget public", description: "Comment l’État collecte, répartit et utilise l’argent public.", sortOrder: 3 },
];

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGIN || "https://thomastechene.github.io";
  if (origin !== allowed) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin",
  };
}

function json(request: Request, env: Env, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request, env) } });
}

function failure(request: Request, env: Env, message: string, status = 400) {
  return json(request, env, { error: message }, status);
}

function validateInput(value: unknown): Input {
  if (!value || typeof value !== "object") throw new Error("Les données sont invalides.");
  const body = value as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title) throw new Error("Un titre est requis.");
  if (title.length > 120 || description.length > 2000) throw new Error("Le titre ou la description est trop long.");
  return { title, description };
}

function card(row: Record<string, unknown>): Card {
  return { id: String(row.id), title: String(row.title), description: String(row.description || ""), sortOrder: Number(row.sort_order || 0) };
}

function topic(row: Record<string, unknown>): Topic { return { ...card(row), categoryId: String(row.category_id) }; }

function merge<T extends { id: string; sortOrder: number }>(defaults: T[], stored: T[], deleted = new Set<string>()) {
  const values = new Map(defaults.filter((item) => !deleted.has(item.id)).map((item) => [item.id, item]));
  stored.forEach((item) => values.set(item.id, item));
  return [...values.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

function constantTimeEqual(left: string, right: string) {
  const a = encoder.encode(left); const b = encoder.encode(right); let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sessionToken(env: Env) {
  const expiry = Date.now() + 1000 * 60 * 60 * 12;
  const payload = `${expiry}.${crypto.randomUUID()}`;
  return `${payload}.${await hmac(payload, env.EDITOR_SESSION_SECRET)}`;
}

async function isEditor(request: Request, env: Env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const [expiry, nonce, signature] = token.split(".");
  if (!expiry || !nonce || !signature || Number(expiry) < Date.now()) return false;
  return constantTimeEqual(await hmac(`${expiry}.${nonce}`, env.EDITOR_SESSION_SECRET), signature);
}

async function storedCategory(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT id, title, description, sort_order FROM categories WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? card(row) : null;
}

async function isDeleted(env: Env, type: "category" | "topic", id: string) {
  const row = await env.DB.prepare("SELECT id FROM deleted_cards WHERE card_type = ? AND id = ?").bind(type, id).first();
  return Boolean(row);
}

async function deletedIds(env: Env, type: "category" | "topic") {
  const result = await env.DB.prepare("SELECT id FROM deleted_cards WHERE card_type = ?").bind(type).all<{ id: string }>();
  return new Set(result.results.map((row) => row.id));
}

async function ensureCategory(env: Env, id: string) {
  if (await isDeleted(env, "category", id)) throw new Error("Cette catégorie est introuvable.");
  const existing = await storedCategory(env, id);
  if (existing) return existing;
  const fallback = defaultCategories.find((item) => item.id === id);
  if (!fallback) throw new Error("Cette catégorie est introuvable.");
  return writeCategory(env, fallback, id);
}

async function writeCategory(env: Env, input: Input & { sortOrder?: number }, id: string = crypto.randomUUID()) {
  const timestamp = new Date().toISOString();
  const fallback = defaultCategories.find((item) => item.id === id);
  await env.DB.prepare("INSERT INTO categories (id, title, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, sort_order = excluded.sort_order, updated_at = excluded.updated_at")
    .bind(id, input.title, input.description, input.sortOrder ?? fallback?.sortOrder ?? Date.now(), timestamp, timestamp).run();
  const result = await storedCategory(env, id);
  if (!result) throw new Error("La catégorie n’a pas pu être enregistrée.");
  return result;
}

async function listCategories(env: Env) {
  const result = await env.DB.prepare("SELECT id, title, description, sort_order FROM categories ORDER BY sort_order ASC").all<Record<string, unknown>>();
  return merge(defaultCategories, result.results.map(card), await deletedIds(env, "category"));
}

async function listTopics(env: Env, categoryId: string) {
  if (await isDeleted(env, "category", categoryId)) return [];
  const result = await env.DB.prepare("SELECT id, category_id, title, description, sort_order FROM topics WHERE category_id = ? ORDER BY sort_order ASC").bind(categoryId).all<Record<string, unknown>>();
  return merge(defaultTopics.filter((item) => item.categoryId === categoryId), result.results.map(topic), await deletedIds(env, "topic"));
}

async function writeTopic(env: Env, categoryId: string, input: Input, id: string = crypto.randomUUID()) {
  await ensureCategory(env, categoryId);
  const timestamp = new Date().toISOString();
  const fallback = defaultTopics.find((item) => item.id === id);
  await env.DB.prepare("INSERT INTO topics (id, category_id, title, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, title = excluded.title, description = excluded.description, sort_order = excluded.sort_order, updated_at = excluded.updated_at")
    .bind(id, categoryId, input.title, input.description, fallback?.sortOrder ?? Date.now(), timestamp, timestamp).run();
  const row = await env.DB.prepare("SELECT id, category_id, title, description, sort_order FROM topics WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new Error("Le sujet n’a pas pu être enregistré.");
  return topic(row);
}

async function deleteCategory(env: Env, id: string) {
  if (!id) throw new Error("Catégorie requise.");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO deleted_cards (card_type, id, deleted_at) VALUES ('category', ?, ?) ON CONFLICT(card_type, id) DO UPDATE SET deleted_at = excluded.deleted_at").bind(id, new Date().toISOString()),
    env.DB.prepare("DELETE FROM topics WHERE category_id = ?").bind(id),
    env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id),
  ]);
}

async function deleteTopic(env: Env, id: string) {
  if (!id) throw new Error("Sujet requis.");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO deleted_cards (card_type, id, deleted_at) VALUES ('topic', ?, ?) ON CONFLICT(card_type, id) DO UPDATE SET deleted_at = excluded.deleted_at").bind(id, new Date().toISOString()),
    env.DB.prepare("DELETE FROM topics WHERE id = ?").bind(id),
  ]);
}

async function content(request: Request, env: Env, path: string) {
  if (request.method === "GET" && path === "/categories") return json(request, env, { categories: await listCategories(env) });
  if (request.method === "GET" && path === "/topics") {
    const categoryId = new URL(request.url).searchParams.get("categoryId");
    if (!categoryId) return failure(request, env, "Catégorie requise.");
    return json(request, env, { topics: await listTopics(env, categoryId) });
  }
  if (!(await isEditor(request, env))) return failure(request, env, "Accès éditeur requis.", 403);
  if (request.method === "DELETE" && path.startsWith("/categories/")) {
    await deleteCategory(env, decodeURIComponent(path.slice(12)));
    return json(request, env, { ok: true });
  }
  if (request.method === "DELETE" && path.startsWith("/topics/")) {
    await deleteTopic(env, decodeURIComponent(path.slice(8)));
    return json(request, env, { ok: true });
  }
  if (request.method !== "POST" && request.method !== "PUT") return failure(request, env, "Route introuvable.", 404);
  const body = await request.json();
  const input = validateInput(body);
  if (request.method === "POST" && path === "/categories") return json(request, env, { category: await writeCategory(env, input) }, 201);
  if (request.method === "PUT" && path.startsWith("/categories/")) return json(request, env, { category: await writeCategory(env, input, decodeURIComponent(path.slice(12))) });
  const categoryId = typeof (body as Record<string, unknown>).categoryId === "string" ? (body as Record<string, string>).categoryId : "";
  if (!categoryId) return failure(request, env, "Catégorie requise.");
  if (request.method === "POST" && path === "/topics") return json(request, env, { topic: await writeTopic(env, categoryId, input) }, 201);
  if (request.method === "PUT" && path.startsWith("/topics/")) return json(request, env, { topic: await writeTopic(env, categoryId, input, decodeURIComponent(path.slice(8))) });
  return failure(request, env, "Route introuvable.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "POST" && path === "/session") {
        const body = await request.json() as { code?: unknown };
        if (typeof body.code !== "string" || !constantTimeEqual(body.code, env.EDITOR_ACCESS_CODE)) return failure(request, env, "Code incorrect.", 401);
        return json(request, env, { token: await sessionToken(env) });
      }
      if (request.method === "GET" && path === "/health") return json(request, env, { ok: true });
      return await content(request, env, path);
    } catch (error) {
      console.error(error);
      return failure(request, env, error instanceof Error ? error.message : "Service temporairement indisponible.", 503);
    }
  },
};
