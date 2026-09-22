/**
 * ElFilme — Cloudflare Worker for elfilme.com (Worker name: elfilme-app).
 * Deploy this single file as the worker script.
 *
 * Catalog keys match the live worker. Env overrides win when present:
 * TMDB_KEY / TMDB_API_KEY and JSONBIN_MASTER_KEY / MASTER_KEY.
 */

const TMDB_KEY_DEFAULT = "14c15425ed275359fc0fc82fbbda1e62";
const JSONBIN_MASTER_KEY_DEFAULT = "$2a$10$2FU4DfoZscB5BrItbrVx3ezRVN5ynuE1zH1Zy3X6IW5NP8p3pigwe";
const ESTRENOS_BIN = "69ce041936566621a870294e";
const NOTICIERO_BIN = "69cc735aaaba882197b21a03";
const LOGO_URL = "https://pub-f72a1045793847688e3debefd7b7d7b7.r2.dev/file_00000000e2f871fda533f931a0804c91.png";
const SYNAPT_FOOTER = "<div class='synapt-co-brand' style='text-align:center;padding:14px 12px 6px;'><a href='https://synapt.live' target='_blank' rel='noopener' title='SYNAPT Network'><img src='https://media.infoamerica.press/branding/synapt-network-logo-footer.png' alt='SYNAPT Network' style='height:36px;width:auto;max-width:160px;opacity:.92;display:inline-block;'/></a></div>";
const COFFEE = '<div style="text-align:center;padding:12px;"><a href="https://buymeacoffee.com/synaptnetwork" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;background:#FFDD00;color:#000;font-family:Arial,sans-serif;font-weight:700;font-size:13px;padding:9px 18px;border-radius:8px;text-decoration:none;margin:8px auto;">&#9749; Apoya SYNAPT Network</a></div>';

function tmdbKey(env) {
  return (env && (env.TMDB_KEY || env.TMDB_API_KEY)) || TMDB_KEY_DEFAULT;
}
function masterKey(env) {
  return (env && (env.JSONBIN_MASTER_KEY || env.MASTER_KEY)) || JSONBIN_MASTER_KEY_DEFAULT;
}

function extractYouTubeId(input) {
  if (input == null || input === "") return null;
  if (typeof input === "object") {
    if (Array.isArray(input)) {
      for (let i = 0; i < input.length; i++) {
        const nested = extractYouTubeId(input[i]);
        if (nested) return nested;
      }
      return null;
    }
    return extractYouTubeId(input.key || input.id || input.youtubeId || input.youtube_id || input.url || input.src || "");
  }
  const raw = String(input).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/,
    /\/v\/([a-zA-Z0-9_-]{11})/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = raw.match(patterns[i]);
    if (match) return match[1];
  }
  return null;
}

function pickYouTubeTrailer(results) {
  let best = null;
  let bestScore = -1;
  const list = results || [];
  for (let i = 0; i < list.length; i++) {
    const video = list[i];
    if (!video || video.site !== "YouTube") continue;
    const key = extractYouTubeId(video.key);
    if (!key) continue;
    let score = 10;
    if (video.type === "Trailer") score = 100;
    else if (video.type === "Teaser") score = 60;
    else if (video.type === "Clip") score = 30;
    if (video.official) score += 15;
    if (video.iso_639_1 === "es") score += 20;
    else if (video.iso_639_1 === "en") score += 8;
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

function youtubeEmbed(id, autoplay) {
  const yt = extractYouTubeId(id);
  if (!yt) return "";
  let src = "https://www.youtube.com/embed/" + yt + "?rel=0&modestbranding=1&playsinline=1";
  if (autoplay) src += "&autoplay=1";
  return src;
}

function escHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function safeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(raw)) return "";
  return raw;
}

function justWatchUrl(title) {
  return "https://www.justwatch.com/mx/buscar?q=" + encodeURIComponent(String(title || ""));
}

function mediaUrl(path) {
  if (!path) return "";
  const raw = String(path).trim();
  if (raw.indexOf("//") === 0) return safeHttpUrl("https:" + raw);
  if (raw.charAt(0) === "/") return "https://image.tmdb.org/t/p/w500" + raw;
  return safeHttpUrl(raw);
}

function isDigits(value) {
  const s = String(value || "");
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function cleanId(prefix, raw, index) {
  const s = String(raw == null ? index : raw);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    const ok = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "-";
    if (ok) out += ch;
  }
  return prefix + (out || String(index));
}

function bindDialogKeys(dialog, onClose) {
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialog) return;
    const sel = dialog.querySelectorAll("button, a[href], input, textarea, select, iframe");
    const list = [];
    for (let i = 0; i < sel.length; i++) {
      if (!sel[i].disabled) list.push(sel[i]);
    }
    if (!list.length) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener("keydown", onKey);
  return function () { document.removeEventListener("keydown", onKey); };
}

function trailerFrame(id, autoplay) {
  const src = youtubeEmbed(id, autoplay);
  if (!src) return "";
  return '<iframe title="Trailer de YouTube" src="' + src + '" allow="autoplay; encrypted-media; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
}

function emptyTrailerHtml(title, detail) {
  return '<div class="trailer-empty"><div class="empty-mark" aria-hidden="true">▶</div><p>' + escHtml(title || "No hay trailer disponible") + "</p><span>" + escHtml(detail || "No encontramos un video de YouTube para este título.") + "</span></div>";
}

function ensureTrailer(item) {
  if (!ensureTrailer.memo) ensureTrailer.memo = {};
  const memo = ensureTrailer.memo;
  const source = item || {};
  const known = extractYouTubeId(source.trailerUrl || source.trailer || source.trailer_url || source.youtube || "");
  if (known) return Promise.resolve(known);
  const tmdbId = source.tmdbId || source.tmdb_id || "";
  if (!isDigits(tmdbId)) return Promise.resolve(null);
  const type = source.type === "series" || source.type === "tv" ? "tv" : "movie";
  const memoKey = type + ":" + tmdbId;
  if (Object.prototype.hasOwnProperty.call(memo, memoKey)) return Promise.resolve(memo[memoKey]);
  return fetch("/api/trailer?tmdb_id=" + encodeURIComponent(tmdbId) + "&type=" + type)
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (pack) {
      const data = pack.data || {};
      if (data.youtubeId) {
        const id = extractYouTubeId(data.youtubeId);
        memo[memoKey] = id;
        if (id) source.trailerUrl = id;
        return id;
      }
      if (pack.ok && data.ok) {
        memo[memoKey] = null;
        return null;
      }
      return fallbackTrailer(tmdbId, type, source, memo, memoKey);
    })
    .catch(function () { return fallbackTrailer(tmdbId, type, source, memo, memoKey); });
}

function fallbackTrailer(tmdbId, type, source, memo, memoKey) {
  if (typeof TMDB_KEY !== "string" || !TMDB_KEY) {
    memo[memoKey] = null;
    return Promise.resolve(null);
  }
  const media = type === "tv" ? "tv" : "movie";
  const urls = [
    "https://api.themoviedb.org/3/" + media + "/" + tmdbId + "/videos?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=es-MX",
    "https://api.themoviedb.org/3/" + media + "/" + tmdbId + "/videos?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=en-US"
  ];
  return Promise.all(urls.map(function (url) {
    return fetch(url).then(function (res) { return res.ok ? res.json() : { results: [] }; }).catch(function () { return { results: [] }; });
  })).then(function (parts) {
    let all = [];
    parts.forEach(function (part) { all = all.concat(part.results || []); });
    const id = pickYouTubeTrailer(all);
    memo[memoKey] = id || null;
    if (id) source.trailerUrl = id;
    return id || null;
  });
}

function createTrailerController(opts) {
  const modal = document.getElementById("trailerModal");
  const stage = document.getElementById("trailerStage");
  const titleEl = document.getElementById("trailerTitle");
  const foot = document.getElementById("trailerFoot");
  let token = 0;
  let unbind = null;
  let lastFocus = null;

  function close() {
    token += 1;
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("hidden", "");
    if (stage) stage.innerHTML = "";
    document.body.style.overflow = "";
    if (unbind) { unbind(); unbind = null; }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function open(item) {
    if (!modal || !stage) return;
    const mine = ++token;
    lastFocus = document.activeElement;
    if (titleEl) titleEl.textContent = (item && item.title) || "Trailer";
    if (foot) {
      const watch = item && (item.watchUrl || item.justwatchUrl);
      foot.innerHTML = watch ? '<a class="btn-ghost" href="' + escHtml(watch) + '" target="_blank" rel="noopener">Dónde verla</a>' : "";
    }
    stage.innerHTML = '<div class="trailer-empty"><div class="spinner"></div><p>Buscando trailer…</p></div>';
    modal.removeAttribute("hidden");
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    const dialog = modal.querySelector(".trailer-dialog");
    if (unbind) unbind();
    unbind = bindDialogKeys(dialog, close);
    const closer = modal.querySelector(".icon-btn");
    if (closer) closer.focus();
    Promise.resolve(opts.resolve(item)).then(function (yt) {
      if (mine !== token) return;
      const frame = trailerFrame(yt, true);
      stage.innerHTML = frame || emptyTrailerHtml("No hay trailer disponible", "No encontramos un video de YouTube para este título.");
    }).catch(function () {
      if (mine !== token) return;
      stage.innerHTML = emptyTrailerHtml("No hay trailer disponible", "No pudimos cargar el video. Inténtalo de nuevo.");
    });
  }

  document.addEventListener("click", function (e) {
    const el = e.target.closest("[data-action='close-trailer']");
    if (!el || !modal || !modal.contains(el)) return;
    e.preventDefault();
    close();
  });

  return { open: open, close: close };
}

function delegateActions(map) {
  document.addEventListener("click", function (e) {
    const link = e.target.closest("a[href]");
    if (link && !link.getAttribute("data-action")) return;
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const fn = map[el.getAttribute("data-action")];
    if (!fn) return;
    if (el.tagName === "BUTTON") e.preventDefault();
    fn(el, e);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    const el = e.target.closest("[data-action]");
    if (!el || el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const fn = map[el.getAttribute("data-action")];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });
}

function installImageFallback() {
  document.addEventListener("error", function (e) {
    const img = e.target;
    if (!img || img.tagName !== "IMG" || !img.getAttribute("data-fallback")) return;
    img.removeAttribute("data-fallback");
    const ph = document.createElement("div");
    ph.className = img.classList.contains("hero-still") ? "hero-still placeholder" : "card-poster-placeholder";
    ph.textContent = "ELFILME";
    if (img.parentNode) img.parentNode.replaceChild(ph, img);
  }, true);
}

const SHARED_BROWSER = [
  extractYouTubeId,
  pickYouTubeTrailer,
  youtubeEmbed,
  escHtml,
  safeHttpUrl,
  justWatchUrl,
  mediaUrl,
  isDigits,
  cleanId,
  bindDialogKeys,
  trailerFrame,
  emptyTrailerHtml,
  ensureTrailer,
  fallbackTrailer,
  createTrailerController,
  delegateActions,
  installImageFallback
].map(function (fn) { return fn.toString(); }).join("\n");

if (SHARED_BROWSER.includes("${")) {
  throw new Error("Browser bundle must not contain template placeholders");
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    }
  });
}

function json(data, status = 200, extraHeaders) {
  const headers = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return new Response(JSON.stringify(data), { status, headers });
}

async function fetchTmdbVideos(env, media, id, lang) {
  const url = "https://api.themoviedb.org/3/" + media + "/" + id + "/videos?api_key=" + encodeURIComponent(tmdbKey(env)) + "&language=" + encodeURIComponent(lang);
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

async function resolveTmdbTrailer(env, tmdbId, type) {
  const primary = type === "tv" ? "tv" : "movie";
  const secondary = primary === "tv" ? "movie" : "tv";
  async function collect(media) {
    const batches = await Promise.all(["es-MX", "en-US"].map(function (lang) {
      return fetchTmdbVideos(env, media, tmdbId, lang).catch(function () { return []; });
    }));
    return batches.flat();
  }
  const first = pickYouTubeTrailer(await collect(primary));
  if (first) return first;
  return pickYouTubeTrailer(await collect(secondary));
}

async function getAuthUser(request) {
  const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = (hash << 5) - hash + ip.charCodeAt(i);
    hash |= 0;
  }
  return { id: Math.abs(hash), username: "Cinefilo", email: "guest@elfilme.com", role: "member" };
}

async function handleAPI(path, method, request, env) {
  try {
    if (path === "/api/trailer" && method === "GET") {
      const url = new URL(request.url);
      const tmdbId = url.searchParams.get("tmdb_id") || url.searchParams.get("id") || "";
      const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
      if (!isDigits(tmdbId) || tmdbId.length > 12) return json({ ok: false, error: "id invalido" }, 400);
      try {
        const youtubeId = await resolveTmdbTrailer(env, tmdbId, type);
        return json(
          { ok: true, youtubeId: youtubeId || null, embed: youtubeId ? "https://www.youtube.com/embed/" + youtubeId : null },
          200,
          { "Cache-Control": "public, max-age=3600" }
        );
      } catch (e) {
        return json({ ok: false, error: "No se pudo consultar el trailer" }, 502);
      }
    }

    if (path === "/api/admin/movies" && method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (auth !== "Bearer " + env.ADMIN_SECRET) return json({ error: "No autorizado" }, 403);
      const b = await request.json();
      if (!b.title || !b.overview_es) return json({ error: "Datos incompletos" }, 400);
      try {
        const r = await env.DB.prepare(
          "INSERT INTO movies (tmdb_id, title, title_es, overview, overview_es, poster_path, backdrop_path, release_date, rating, genres, trailer_url, categoria, is_featured, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))"
        ).bind(
          b.tmdb_id || null, b.title, b.title_es || b.title, b.overview || "", b.overview_es,
          b.poster_path || null, b.backdrop_path || null, b.release_date || null,
          b.rating || null, b.genres || "", b.trailer_url || null, b.categoria || "resena", b.is_featured ? 1 : 0
        ).run();
        return json({ ok: true, id: r.meta.last_row_id });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    if (path === "/api/admin/articulos" && method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (auth !== "Bearer " + env.ADMIN_SECRET) return json({ error: "No autorizado" }, 403);
      const b = await request.json();
      if (!b.titulo || !b.contenido || !b.tipo) return json({ error: "Datos incompletos" }, 400);
      try {
        const r = await env.DB.prepare(
          "INSERT INTO articulos (titulo, contenido, resumen, imagen_url, tipo, is_active, created_at) VALUES (?,?,?,?,?,1,datetime('now'))"
        ).bind(b.titulo, b.contenido, b.resumen || "", b.imagen_url || null, b.tipo).run();
        return json({ ok: true, id: r.meta.last_row_id });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    if (path === "/api/articulos" && method === "GET") {
      const url2 = new URL(request.url);
      const tipo = url2.searchParams.get("tipo");
      const limit = parseInt(url2.searchParams.get("limit") || "20", 10);
      let sql = "SELECT * FROM articulos WHERE is_active=1";
      const params = [];
      if (tipo) { sql += " AND tipo=?"; params.push(tipo); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(String(limit));
      const arts = await env.DB.prepare(sql).bind(...params).all();
      return json({ ok: true, articulos: arts.results });
    }

    if (path === "/api/catalog" && method === "GET") {
      try {
        const res = await env.DB.prepare("SELECT * FROM catalog WHERE is_active=1 ORDER BY category, id").all();
        return json({ ok: true, movies: res.results });
      } catch (e) {
        return json({ ok: true, movies: [] });
      }
    }

    if (path === "/api/watchlist" && method === "GET") {
      const user = await getAuthUser(request);
      const items = await env.DB.prepare("SELECT * FROM watchlist WHERE user_id=? ORDER BY added_at DESC").bind(user.id).all();
      return json({ ok: true, items: items.results });
    }

    if (path === "/api/watchlist" && method === "POST") {
      const user = await getAuthUser(request);
      const body = await request.json();
      if (!body.tmdb_id || !body.title) return json({ error: "Datos incompletos" }, 400);
      try {
        await env.DB.prepare("INSERT INTO watchlist (user_id, tmdb_id, title, poster_path) VALUES (?, ?, ?, ?)").bind(user.id, body.tmdb_id, body.title, body.poster_path || "").run();
        return json({ ok: true });
      } catch (e) {
        return json({ error: "Ya esta en tu lista" }, 409);
      }
    }

    if (path.startsWith("/api/watchlist/") && method === "DELETE") {
      const user = await getAuthUser(request);
      const tmdbId = path.split("/").pop();
      await env.DB.prepare("DELETE FROM watchlist WHERE user_id=? AND tmdb_id=?").bind(user.id, tmdbId).run();
      return json({ ok: true });
    }

    if (path.startsWith("/api/comments/") && method === "GET") {
      const tmdbId = path.split("/").pop();
      const comments = await env.DB.prepare("SELECT c.id, c.body, c.rating, c.created_at FROM comments c WHERE c.tmdb_id=? AND c.is_active=1 ORDER BY c.created_at DESC LIMIT 50").bind(tmdbId).all();
      return json({ ok: true, comments: comments.results });
    }

    if (path === "/api/comments" && method === "POST") {
      const user = await getAuthUser(request);
      const body = await request.json();
      if (!body.tmdb_id || !body.body || String(body.body).trim().length < 3) return json({ error: "Comentario muy corto" }, 400);
      await env.DB.prepare("INSERT INTO comments (user_id, tmdb_id, movie_title, body, rating) VALUES (?, ?, ?, ?, ?)").bind(user.id, body.tmdb_id, body.movie_title || "", String(body.body).trim(), body.rating || null).run();
      return json({ ok: true });
    }

    if (path === "/api/profile" && method === "GET") {
      const user = await getAuthUser(request);
      const u = { id: user.id, username: "Cinefilo", email: "Invitado", role: "member" };
      const stats = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM watchlist WHERE user_id=?) as watchlist, (SELECT COUNT(*) FROM history WHERE user_id=?) as watched, (SELECT COUNT(*) FROM ratings WHERE user_id=?) as ratings").bind(user.id, user.id, user.id).first();
      return json({ ok: true, user: u, stats });
    }

    if (path === "/api/profile" && method === "POST") return json({ ok: true });

    if (path === "/api/history" && method === "POST") {
      const user = await getAuthUser(request);
      const body = await request.json();
      if (!body.tmdb_id || !body.title) return json({ error: "Datos incompletos" }, 400);
      try {
        await env.DB.prepare('INSERT INTO history (user_id,tmdb_id,title,poster_path,type) VALUES (?,?,?,?,?) ON CONFLICT(user_id,tmdb_id) DO UPDATE SET watched_at=datetime("now")').bind(user.id, String(body.tmdb_id), body.title, body.poster_path || "", body.type || "movie").run();
      } catch (e) {
        await env.DB.prepare("DELETE FROM history WHERE user_id=? AND tmdb_id=?").bind(user.id, String(body.tmdb_id)).run();
        await env.DB.prepare("INSERT INTO history (user_id,tmdb_id,title,poster_path,type) VALUES (?,?,?,?,?)").bind(user.id, String(body.tmdb_id), body.title, body.poster_path || "", body.type || "movie").run();
      }
      return json({ ok: true });
    }

    if (path === "/api/history" && method === "GET") {
      const user = await getAuthUser(request);
      const items = await env.DB.prepare("SELECT * FROM history WHERE user_id=? ORDER BY watched_at DESC LIMIT 100").bind(user.id).all();
      return json({ ok: true, items: items.results });
    }

    if (path === "/api/ratings" && method === "POST") {
      const user = await getAuthUser(request);
      const body = await request.json();
      if (!body.tmdb_id || !body.stars || body.stars < 1 || body.stars > 5) return json({ error: "Calificacion invalida" }, 400);
      try {
        await env.DB.prepare('INSERT INTO ratings (user_id,tmdb_id,movie_title,stars,review) VALUES (?,?,?,?,?) ON CONFLICT(user_id,tmdb_id) DO UPDATE SET stars=excluded.stars,review=excluded.review,updated_at=datetime("now")').bind(user.id, String(body.tmdb_id), body.movie_title || "", body.stars, body.review || "").run();
      } catch (e) {
        await env.DB.prepare("DELETE FROM ratings WHERE user_id=? AND tmdb_id=?").bind(user.id, String(body.tmdb_id)).run();
        await env.DB.prepare("INSERT INTO ratings (user_id,tmdb_id,movie_title,stars,review) VALUES (?,?,?,?,?)").bind(user.id, String(body.tmdb_id), body.movie_title || "", body.stars, body.review || "").run();
      }
      return json({ ok: true });
    }

    if (path.startsWith("/api/ratings/") && method === "GET") {
      const tmdbId = path.split("/").pop();
      const avg = await env.DB.prepare("SELECT AVG(stars) as avg, COUNT(*) as total FROM ratings WHERE tmdb_id=?").bind(tmdbId).first();
      const user = await getAuthUser(request);
      const mine = await env.DB.prepare("SELECT stars,review FROM ratings WHERE user_id=? AND tmdb_id=?").bind(user.id, tmdbId).first();
      return json({ ok: true, avg: avg && avg.avg ? Number(avg.avg).toFixed(1) : null, total: avg ? avg.total : 0, mine });
    }

    if (path === "/api/requests" && method === "POST") {
      const user = await getAuthUser(request);
      const body = await request.json();
      if (!body.title || String(body.title).trim().length < 2) return json({ error: "Titulo requerido" }, 400);
      const recent = await env.DB.prepare('SELECT COUNT(*) as c FROM movie_requests WHERE user_id=? AND created_at > datetime("now","-1 day")').bind(user.id).first();
      if (recent && recent.c >= 3) return json({ error: "Maximo 3 solicitudes por dia" }, 429);
      await env.DB.prepare("INSERT INTO movie_requests (user_id,username,title,year,notes) VALUES (?,?,?,?,?)").bind(user.id, "Cinefilo", String(body.title).trim(), body.year || "", body.notes || "").run();
      return json({ ok: true });
    }

    if (path === "/api/movies" && method === "GET") {
      const url2 = new URL(request.url);
      const genre = url2.searchParams.get("genre");
      const categoria = url2.searchParams.get("categoria");
      const limit = parseInt(url2.searchParams.get("limit") || "50", 10);
      let sql = "SELECT * FROM movies WHERE is_active=1";
      const params = [];
      if (genre) { sql += " AND genres LIKE ?"; params.push("%" + genre + "%"); }
      if (categoria) { sql += " AND categoria=?"; params.push(categoria); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(String(limit));
      const movies = await env.DB.prepare(sql).bind(...params).all();
      return json({ ok: true, movies: movies.results });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: "Error del servidor" }, 500);
  }
}

function trailerModalMarkup() {
  return '<div class="trailer-modal" id="trailerModal" hidden>' +
    '<div class="trailer-backdrop" data-action="close-trailer"></div>' +
    '<div class="trailer-dialog" role="dialog" aria-modal="true" aria-labelledby="trailerTitle">' +
    '<div class="trailer-top"><div><p class="trailer-kicker">YouTube</p><h3 id="trailerTitle">Trailer</h3></div>' +
    '<button type="button" class="icon-btn" data-action="close-trailer" aria-label="Cerrar trailer">×</button></div>' +
    '<div class="trailer-stage" id="trailerStage" aria-live="polite"></div>' +
    '<div class="trailer-foot" id="trailerFoot"></div></div></div>';
}

const CINE_CSS = `
:root{--bg:#070708;--bg2:#101014;--bg3:#1b1b22;--glass:rgba(255,255,255,.05);--line:rgba(255,255,255,.1);--text:#f6f3ee;--muted:#b7b1a8;--faint:#7c776f;--accent:#e50914;--accent2:#ff2d38;--gold:#e6c56b;--radius:16px;--shadow:0 24px 70px rgba(0,0,0,.45);--sans:'Outfit',sans-serif;--display:'Bebas Neue',sans-serif;--serif:'Playfair Display',Georgia,serif;}
*{box-sizing:border-box;margin:0;padding:0;}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;line-height:1.5;}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(900px 480px at 8% -10%,rgba(229,9,20,.18),transparent 60%),radial-gradient(700px 420px at 100% 0%,rgba(229,9,20,.08),transparent 55%);}
body>*{position:relative;z-index:1;}
img{max-width:100%;}
button,input,textarea{font-family:inherit;color:inherit;}
a{color:inherit;}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;}
.loader-bar{position:fixed;top:0;left:0;height:3px;width:35%;background:linear-gradient(90deg,transparent,var(--accent),#fff);z-index:80;animation:load 1.1s ease infinite;}
@keyframes load{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
.wordmark{font-family:var(--display);letter-spacing:.12em;font-size:1.7rem;color:#fff;line-height:1;}
.wordmark span{color:var(--accent);}
.icon-btn,.modal-close{width:40px;height:40px;border-radius:999px;border:1px solid var(--line);background:rgba(0,0,0,.35);color:#fff;cursor:pointer;font-size:1.3rem;}
.icon-btn:hover,.modal-close:hover{background:var(--accent);border-color:transparent;}
[hidden]{display:none !important;}
.btn-trailer,.btn-watch{appearance:none;border:0;cursor:pointer;background:var(--accent);color:#fff;border-radius:12px;padding:.85rem 1.15rem;font-weight:600;letter-spacing:.01em;box-shadow:0 10px 28px rgba(229,9,20,.35);text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:44px;}
.btn-trailer:hover,.btn-watch:hover{background:var(--accent2);transform:translateY(-2px);}
.btn-ghost,.btn-info{appearance:none;cursor:pointer;background:rgba(255,255,255,.06);color:#fff;border:1px solid var(--line);border-radius:12px;padding:.85rem 1.05rem;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;min-height:44px;}
.btn-ghost:hover,.btn-info:hover{background:rgba(255,255,255,.12);}
.btn-tiny{border:1px solid var(--line);background:rgba(0,0,0,.45);color:#fff;border-radius:999px;padding:.35rem .65rem;font-size:.72rem;text-decoration:none;cursor:pointer;min-height:32px;}
.btn-tiny-red{background:var(--accent);border-color:transparent;font-weight:700;}
.btn-tiny:hover{transform:translateY(-1px);}
.trailer-modal{position:fixed;inset:0;z-index:60;display:none;}
.trailer-modal.open{display:flex;align-items:flex-end;justify-content:center;}
.trailer-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.78);backdrop-filter:blur(10px);}
.trailer-dialog{position:relative;width:100%;background:#0c0c10;border:1px solid rgba(255,255,255,.12);box-shadow:var(--shadow);animation:sheet .28s ease;}
@keyframes sheet{from{transform:translateY(28px);opacity:.4}to{transform:none;opacity:1}}
.trailer-top{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.9rem 1rem .7rem;}
.trailer-kicker{font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700;}
.trailer-top h3{font-family:var(--serif);font-size:1.25rem;line-height:1.2;}
.trailer-stage{position:relative;aspect-ratio:16/9;background:#000;}
.trailer-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;}
.trailer-foot{display:flex;justify-content:flex-end;padding:.75rem 1rem 1rem;}
.trailer-empty{height:100%;min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:.45rem;padding:1.4rem;color:var(--muted);}
.trailer-empty p{color:var(--text);font-weight:600;}
.trailer-empty span{max-width:38ch;font-size:.88rem;}
.empty-mark{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;background:rgba(229,9,20,.16);color:#fff;}
.spinner{width:36px;height:36px;border-radius:50%;border:3px solid rgba(255,255,255,.16);border-top-color:var(--accent);animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.toast{position:fixed;bottom:1.2rem;left:50%;transform:translateX(-50%) translateY(12px);background:#141418;border:1px solid var(--line);border-radius:999px;padding:.7rem 1.1rem;z-index:75;opacity:0;pointer-events:none;transition:.3s;}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
@media(min-width:840px){
  .trailer-modal.open{align-items:center;padding:28px;}
  .trailer-dialog{width:min(980px,100%);border-radius:20px;overflow:hidden;}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}
`;
const HOME_CSS = `
header{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:.7rem;height:72px;padding:0 max(1rem, env(safe-area-inset-left)) 0 max(1rem, env(safe-area-inset-right));background:rgba(7,7,8,.9);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.06);}
.logo{display:flex;align-items:center;gap:.55rem;background:none;border:0;cursor:pointer;padding:0;min-width:0;}
.logo img{height:36px;width:auto;object-fit:contain;}
.header-search-desktop{position:relative;flex:1;max-width:420px;display:none;}
.header-search-desktop input,.header-search-bar input,.form-input,textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:12px;padding:.75rem .9rem;font-size:16px;outline:none;}
.header-search-desktop input:focus,.header-search-bar input:focus,.form-input:focus,textarea:focus{border-color:rgba(229,9,20,.65);}
.desktop-nav{display:none;align-items:center;gap:.35rem;margin-left:auto;}
.desktop-nav a,.desktop-nav button{background:transparent;border:0;color:var(--muted);text-decoration:none;font-size:.84rem;padding:.45rem .7rem;border-radius:999px;cursor:pointer;}
.desktop-nav a:hover,.desktop-nav button:hover,.desktop-nav .is-hot{color:#fff;background:rgba(255,255,255,.06);}
.desktop-nav .is-hot{color:#fff;box-shadow:inset 0 0 0 1px rgba(229,9,20,.45);}
.header-tools{display:flex;align-items:center;gap:.25rem;margin-left:auto;}
.search-icon-btn,.hamburger,.fav-btn{background:transparent;border:0;color:#fff;width:42px;height:42px;border-radius:12px;cursor:pointer;display:grid;place-items:center;}
.fav-btn{width:auto;padding:0 .55rem;gap:.3rem;display:flex;align-items:center;}
.fav-count{background:var(--accent);border-radius:999px;min-width:1.15rem;height:1.15rem;font-size:.68rem;display:inline-grid;place-items:center;padding:0 .28rem;}
.hamburger span{display:block;width:18px;height:2px;background:#fff;margin:4px 0;border-radius:2px;}
.header-search-bar{position:absolute;left:0;right:0;top:72px;padding:.7rem 1rem;background:rgba(7,7,8,.98);border-bottom:1px solid var(--line);z-index:29;}
.wide-banner img{width:100%;height:auto;display:block;}
.vip-banner{text-align:center;padding:.55rem 1rem;color:rgba(255,255,255,.55);letter-spacing:.16em;font-family:var(--display);font-size:1rem;border-bottom:1px solid rgba(229,9,20,.18);}
.estrenos-banner{position:relative;display:block;overflow:hidden;min-height:168px;cursor:pointer;border-bottom:1px solid rgba(229,9,20,.2);background:#120406;}
.estrenos-banner-bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.28;filter:blur(2px);}
.estrenos-banner-overlay{position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,7,8,.95),rgba(7,7,8,.55) 70%,transparent);}
.estrenos-banner-content{position:relative;z-index:1;display:flex;gap:1rem;align-items:center;padding:1.1rem;}
.estrenos-poster-thumb{width:74px;aspect-ratio:2/3;border-radius:10px;overflow:hidden;flex:0 0 auto;background:#1b1b22;box-shadow:var(--shadow);}
.estrenos-poster-thumb img{width:100%;height:100%;object-fit:cover;}
.estrenos-title{font-family:var(--display);font-size:clamp(1.6rem,3vw,2.4rem);letter-spacing:.04em;line-height:.95;}
.estrenos-subtitle{color:var(--muted);font-size:.82rem;margin:.2rem 0 .55rem;}
.estrenos-badge-row{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.35rem;}
.now-playing-badge,.estrenos-label-badge{font-size:.68rem;letter-spacing:.08em;border-radius:999px;padding:.18rem .5rem;font-weight:700;}
.now-playing-badge{background:var(--accent);color:#fff;}
.estrenos-label-badge{border:1px solid rgba(230,197,107,.45);color:var(--gold);}
.estrenos-count-badge{margin-left:auto;text-align:center;min-width:72px;}
.estrenos-count-num{font-family:var(--display);font-size:2rem;color:var(--accent);line-height:1;}
.estrenos-count-label{font-size:.66rem;letter-spacing:.12em;color:var(--muted);}
.estrenos-ticker{position:relative;z-index:1;overflow:hidden;white-space:nowrap;font-size:.72rem;letter-spacing:.08em;color:rgba(255,255,255,.55);background:rgba(229,9,20,.16);padding:.28rem 0;}
.hero{position:relative;min-height:520px;display:flex;align-items:flex-end;overflow:hidden;}
.hero-bg{position:absolute;inset:0;background:#14080b center/cover no-repeat;transform:scale(1.05);}
.hero-overlay{position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,7,8,.95) 0%,rgba(7,7,8,.62) 48%,rgba(7,7,8,.2) 100%),linear-gradient(to top,#070708,transparent 55%);}
.hero-content{position:relative;z-index:1;width:min(1120px,100%);margin:0 auto;padding:2rem 1.15rem 2.2rem;display:grid;gap:1rem;}
.hero-kicker,.section-kicker{color:var(--accent);letter-spacing:.16em;text-transform:uppercase;font-size:.72rem;font-weight:700;}
.hero-title{font-family:var(--serif);font-weight:600;font-size:clamp(2.3rem,6vw,4.7rem);line-height:.95;letter-spacing:-.03em;}
.hero-meta{display:flex;gap:.7rem;flex-wrap:wrap;color:var(--muted);margin:.75rem 0;font-size:.92rem;}
.hero-meta .rating{color:var(--gold);font-weight:700;}
.hero-overview{color:#ddd7cf;max-width:62ch;}
.hero-actions{display:flex;flex-wrap:wrap;gap:.6rem;}
.hero-still,.hero-still.placeholder{width:min(180px,46vw);aspect-ratio:2/3;object-fit:cover;border-radius:18px;box-shadow:var(--shadow);}
.hero-still.placeholder{display:grid;place-items:center;background:#1b1b22;color:var(--faint);font-family:var(--display);letter-spacing:.12em;}
.genre-bar{display:flex;gap:.45rem;overflow-x:auto;padding:.9rem 1.15rem;scrollbar-width:none;}
.genre-bar::-webkit-scrollbar{display:none;}
.genre-pill{border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);border-radius:999px;padding:.45rem .8rem;cursor:pointer;white-space:nowrap;}
.genre-pill.active{color:#fff;border-color:rgba(229,9,20,.7);background:rgba(229,9,20,.18);}
.row-section{padding:1.1rem 0 1.2rem 1.15rem;}
.section-header{padding-right:1.15rem;margin-bottom:.7rem;}
.section-title-line{font-family:var(--display);font-size:clamp(1.7rem,2.4vw,2.2rem);letter-spacing:.08em;display:flex;align-items:center;gap:.8rem;}
.section-title-line::after{content:"";height:1px;flex:1;background:linear-gradient(90deg,rgba(229,9,20,.8),transparent);}
.row-scroll{display:flex;gap:.8rem;overflow-x:auto;padding:.35rem 1.15rem .9rem 0;scroll-snap-type:x mandatory;scrollbar-width:none;}
.row-scroll::-webkit-scrollbar{display:none;}
.row-scroll .card{flex:0 0 156px;width:156px;}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:.9rem;}
.cards-grid .card{width:auto;}
.card{position:relative;aspect-ratio:2/3;border-radius:16px;overflow:hidden;background:#14141a;border:1px solid rgba(255,255,255,.06);scroll-snap-align:start;cursor:pointer;}
.card-poster{width:100%;height:100%;object-fit:cover;display:block;}
.card-poster-placeholder{width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(160deg,#2a1216,#121216);color:rgba(255,255,255,.45);font-family:var(--display);letter-spacing:.14em;}
.card-bottom{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:.28rem;padding:.8rem .7rem .65rem;background:linear-gradient(to top,rgba(0,0,0,.94) 18%,rgba(0,0,0,.15) 78%,transparent);}
.card-title-ov{font-size:.84rem;line-height:1.25;font-weight:600;}
.card-meta-ov{display:flex;gap:.45rem;color:var(--muted);font-size:.75rem;}
.card-rating{color:var(--gold);font-weight:700;}
.card-actions{display:flex;flex-wrap:wrap;gap:.35rem;}
.card-fav{position:absolute;top:.5rem;right:.5rem;z-index:2;}
.card-type-badge{position:absolute;top:.55rem;left:.55rem;z-index:2;font-size:.6rem;letter-spacing:.08em;background:rgba(0,0,0,.66);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:.18rem .42rem;}
.skeleton{background:linear-gradient(90deg,#19191f 25%,#2c2c34 50%,#19191f 75%);background-size:800px 100%;animation:shimmer 1.3s linear infinite;}
@keyframes shimmer{from{background-position:-400px 0}to{background-position:400px 0}}
.page{display:none;}
.page.active{display:block;animation:rise .35s ease;}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.detail-hero{position:relative;min-height:280px;display:flex;align-items:flex-end;}
.detail-hero-bg{position:absolute;inset:0;background:#12080b center/cover no-repeat;}
.detail-overlay{position:absolute;inset:0;background:linear-gradient(to top,#070708 8%,rgba(7,7,8,.55));}
.detail-content{position:relative;padding:1.3rem 1.15rem 1rem;display:flex;flex-direction:column;gap:.9rem;width:min(1100px,100%);margin:0 auto;}
.detail-row{display:flex;gap:1rem;align-items:flex-end;}
.detail-poster{width:112px;aspect-ratio:2/3;border-radius:14px;overflow:hidden;box-shadow:var(--shadow);background:#1b1b22;flex:0 0 auto;}
.detail-poster img,.detail-poster-ph{width:100%;height:100%;object-fit:cover;}
.detail-poster-ph{display:grid;place-items:center;font-family:var(--display);color:var(--faint);}
.detail-title{font-family:var(--serif);font-size:clamp(1.8rem,4vw,3rem);line-height:1;}
.detail-tagline{color:var(--muted);font-style:italic;}
.detail-meta{display:flex;gap:.7rem;flex-wrap:wrap;color:var(--muted);margin:.45rem 0;}
.detail-meta .rating{color:var(--gold);font-weight:700;}
.genre-tags{display:flex;gap:.35rem;flex-wrap:wrap;}
.genre-tag{border:1px solid var(--line);border-radius:999px;padding:.15rem .55rem;color:var(--muted);font-size:.75rem;}
.detail-desc{color:#ddd6cc;max-width:75ch;}
.detail-btns,.likes-bar{display:flex;flex-wrap:wrap;gap:.55rem;align-items:center;}
.player-section{width:min(1100px,100%);margin:0 auto;padding:0 1.15rem 1rem;}
.player-wrap{position:relative;aspect-ratio:16/9;background:#000;border-radius:16px;overflow:hidden;box-shadow:var(--shadow);}
.player-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
.like-btn{border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--muted);padding:.55rem .9rem;cursor:pointer;}
.like-btn.liked{color:#fff;border-color:rgba(229,9,20,.6);background:rgba(229,9,20,.16);}
.empty-state{text-align:center;padding:3.5rem 1.2rem;color:var(--muted);}
.empty-title{font-family:var(--serif);color:#fff;font-size:1.5rem;margin-bottom:.3rem;}
.search-header{padding:1.4rem 1.15rem .4rem;}
.search-query{font-family:var(--serif);font-size:1.7rem;}
.search-query span{color:var(--accent);}
.menu-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:40;display:none;}
.menu-overlay.open{display:block;}
.side-menu{position:fixed;top:0;right:0;bottom:0;width:min(100%,320px);background:#0d0d11;border-left:1px solid var(--line);z-index:41;transform:translateX(100%);transition:transform .28s ease;padding:1rem 0;overflow:auto;}
.side-menu.open{transform:translateX(0);}
.menu-section-label{padding:.7rem 1.2rem .2rem;color:var(--faint);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;}
.menu-item{display:flex;gap:.7rem;align-items:center;padding:.8rem 1.2rem;color:var(--muted);cursor:pointer;border:0;background:none;width:100%;text-align:left;font-size:.95rem;}
.menu-item:hover{color:#fff;background:rgba(255,255,255,.04);}
.modal-overlay,.req-modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.72);display:none;align-items:flex-start;justify-content:center;padding:1rem;overflow:auto;}
.modal-overlay.open,.req-modal.open{display:flex;}
.modal,.req-box{background:#121218;border:1px solid var(--line);border-radius:18px;width:min(560px,100%);margin:auto;box-shadow:var(--shadow);}
.modal-header{display:flex;justify-content:space-between;align-items:center;padding:1rem 1rem .4rem;}
.modal-title,.req-title{font-family:var(--serif);font-size:1.35rem;}
.modal-body,.req-box{padding:1rem;}
.req-box{padding:1.2rem;}
.req-sub{color:var(--muted);margin:.2rem 0 .8rem;}
.form-footer,.req-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.8rem;}
footer{margin-top:2rem;padding:2rem 1rem 1.4rem;text-align:center;border-top:1px solid rgba(255,255,255,.06);background:#08080a;}
.footer-logo img{height:52px;object-fit:contain;margin-bottom:.6rem;}
.footer-links{display:flex;gap:.9rem;justify-content:center;flex-wrap:wrap;margin-bottom:.7rem;}
.footer-links button,.footer-links a{background:none;border:0;color:var(--faint);cursor:pointer;text-decoration:none;}
.footer-links button:hover,.footer-links a:hover{color:var(--accent);}
.footer-disclaimer,.footer-copy{color:#5c574f;font-size:.75rem;max-width:640px;margin:0 auto .4rem;}
.star-btn{background:none;border:0;font-size:1.5rem;cursor:pointer;color:#5a5348;}
.star-btn.on{color:var(--gold);}
@media (hover:hover) and (pointer:fine){
  .card{transition:transform .25s ease,box-shadow .25s ease;}
  .card:hover,.card:focus-visible{transform:translateY(-8px);box-shadow:0 18px 40px rgba(0,0,0,.45),0 0 0 1px rgba(229,9,20,.4);z-index:2;}
}
@media(min-width:860px){
  .header-search-desktop{display:block;}
  .desktop-nav{display:flex;}
  .header-tools .search-icon-btn,.hamburger{display:none;}
  .header-tools{margin-left:0;}
  .hero-content{grid-template-columns:minmax(0,1fr) 210px;align-items:end;padding:3.2rem 2rem;}
  .hero-still{width:210px;justify-self:end;}
  .estrenos-poster-thumb{width:96px;}
  .detail-content{padding:2.2rem 2rem 1rem;}
  .detail-poster{width:150px;}
}
@media(max-width:700px){
  .estrenos-banner-content{flex-wrap:wrap;}
  .estrenos-count-badge{margin-left:0;}
  .estrenos-title{font-size:1.7rem;}
  .row-scroll .card{flex-basis:44vw;width:44vw;max-width:180px;}
  .cards-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
  .hero{min-height:460px;}
  .detail-row{align-items:flex-start;}
}
`;

const HOME_JS = `
var DB = [];
var DB_SECTIONS = {};
var CARD_POOL = {};
var FAV = [];
var currentGenre = "All";
var currentDetail = null;
var searchTimer = null;
var heroLocked = false;
var catalogPending = true;
var menuUnbind = null;
var infoUnbind = null;
var reqUnbind = null;
var dialogFocus = null;
try { FAV = JSON.parse(localStorage.getItem("elfilme_fav") || "[]") || []; } catch (e) { FAV = []; }
if (!Array.isArray(FAV)) FAV = [];

var GENRE_MAP = {28:"Acción",12:"Aventura",16:"Animación",35:"Comedia",80:"Crimen",99:"Documental",18:"Drama",10751:"Familia",14:"Fantasía",36:"Historia",27:"Terror",10402:"Música",9648:"Misterio",10749:"Romance",878:"Ciencia ficción",53:"Suspenso",10752:"Guerra",37:"Western"};
var SECTIONS = [
  {key:"estrenos", label:"En cines", kicker:"Cartelera ElFilme"},
  {key:"resenas_elfilme", label:"Reseñas de ElFilme", kicker:"Listas ElFilme"},
  {key:"top_elfilme", label:"Top películas", kicker:"Listas ElFilme"},
  {key:"oscar_elfilme", label:"Ganadoras del Oscar", kicker:"Listas ElFilme"},
  {key:"peor_elfilme", label:"Las peores películas", kicker:"Listas ElFilme"},
  {key:"streaming_elfilme", label:"Dónde ver en streaming", kicker:"Listas ElFilme"},
  {key:"gratis_elfilme", label:"Gratis en apps", kicker:"Listas ElFilme"},
  {key:"trending", label:"Tendencias", kicker:"Esta semana"},
  {key:"now_playing", label:"Ahora en cines", kicker:"Cartelera"},
  {key:"popular", label:"Populares", kicker:"Películas"},
  {key:"series", label:"Series populares", kicker:"Series"},
  {key:"accion", label:"Acción", kicker:"Géneros"},
  {key:"comedia", label:"Comedia", kicker:"Géneros"},
  {key:"terror", label:"Terror", kicker:"Géneros"},
  {key:"drama", label:"Drama", kicker:"Géneros"},
  {key:"romance", label:"Romance", kicker:"Géneros"},
  {key:"animacion", label:"Animación", kicker:"Géneros"},
  {key:"anime", label:"Anime", kicker:"Géneros"},
  {key:"documentales", label:"Documentales", kicker:"Géneros"},
  {key:"latino", label:"Cine latino", kicker:"Géneros"},
  {key:"top_rated", label:"Mejor calificadas", kicker:"Películas"},
  {key:"upcoming", label:"Próximos estrenos", kicker:"Cartelera"}
];

function toast(msg) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove("show"); }, 2400);
}
function showLoader(on) {
  var el = document.getElementById("loader");
  if (!el) return;
  if (on) el.removeAttribute("hidden"); else el.setAttribute("hidden", "");
}
function showPage(id) {
  if (typeof trailers !== "undefined" && trailers) trailers.close();
  var pages = document.querySelectorAll(".page");
  for (var i = 0; i < pages.length; i++) pages[i].classList.remove("active");
  var next = document.getElementById("page-" + id);
  if (next) next.classList.add("active");
  closeMenu();
  window.scrollTo(0, 0);
}
function updateFavCount() {
  ["favCount", "favCountDesk", "favCountMenu"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(FAV.length);
  });
}
function asCssUrl(url) {
  if (!url) return "";
  if (url.indexOf("(") >= 0 || url.indexOf(")") >= 0 || url.indexOf("'") >= 0 || url.indexOf('"') >= 0) return "";
  return url;
}
function clip(text, n) {
  var s = String(text || "").replace(/\\s+/g, " ").trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trim() + "…";
}
function findCard(id) {
  for (var i = 0; i < DB.length; i++) if (String(DB[i].id) === String(id)) return DB[i];
  return null;
}
function remember(card) {
  if (!card) return;
  for (var i = 0; i < DB.length; i++) if (DB[i].id === card.id) return;
  DB.push(card);
}
function tmdbToCard(item, type) {
  if (!item || item.media_type === "person" || item.id == null) return null;
  var id = "tmdb_" + item.id;
  if (CARD_POOL[id]) return CARD_POOL[id];
  var media = item.media_type || type || "movie";
  var genres = (item.genre_ids || []).map(function (gid) { return GENRE_MAP[gid]; }).filter(Boolean);
  var title = item.title || item.name || "Sin título";
  var card = {
    id: id,
    title: title,
    type: media === "tv" ? "series" : "movie",
    year: String(item.release_date || item.first_air_date || "").slice(0, 4),
    rating: item.vote_average ? Number(item.vote_average).toFixed(1) : "–",
    genre: genres[0] || "Drama",
    genres: genres,
    poster: item.poster_path || null,
    backdrop: item.backdrop_path || null,
    desc: item.overview || "",
    trailerUrl: null,
    tmdbId: String(item.id),
    justwatchUrl: justWatchUrl(title)
  };
  CARD_POOL[id] = card;
  return card;
}
function mapTmdb(list, type) {
  var out = [];
  (list || []).forEach(function (item) {
    var card = tmdbToCard(item, type);
    if (card) out.push(card);
  });
  return out;
}
function estrenoToCard(p, index) {
  if (!p || !p.title) return null;
  var title = p.title;
  return {
    id: cleanId("estreno_", p.id, index),
    title: title,
    type: "movie",
    year: String(p.release_date || p.year || "").slice(0, 4),
    rating: p.vote_average ? Number(p.vote_average).toFixed(1) : (p.rating || "–"),
    genre: p.category || "Estreno",
    genres: [p.category || "Estreno"],
    poster: p.poster || null,
    backdrop: p.backdrop || p.poster || null,
    desc: p.overview || p.description || "",
    trailerUrl: extractYouTubeId(p.trailer || p.trailer_url || p.trailerUrl || p.youtube || p.youtube_id || p.video || ""),
    tmdbId: p.tmdb_id || p.tmdbId || p.tmdb || "",
    justwatchUrl: justWatchUrl(title),
    isEstreno: true
  };
}
function ownMovieToCard(m) {
  var title = m.title_es || m.title || "Sin título";
  var genres = String(m.genres || "").split(",").map(function (g) { return g.trim(); }).filter(Boolean);
  return {
    id: cleanId("own_", m.id, title),
    title: title,
    type: "movie",
    year: String(m.release_date || "").slice(0, 4),
    rating: m.rating || "–",
    genre: genres[0] || "Drama",
    genres: genres,
    poster: m.poster_path || null,
    backdrop: m.backdrop_path || null,
    desc: m.overview_es || m.overview || "",
    trailerUrl: extractYouTubeId(m.trailer_url || ""),
    tmdbId: m.tmdb_id || "",
    justwatchUrl: justWatchUrl(title),
    source: "elfilme"
  };
}
function articuloToCard(a) {
  return {
    id: cleanId("art_", a.id, a.titulo),
    title: a.titulo || "Lista",
    type: "articulo",
    esArticulo: true,
    year: "",
    rating: "–",
    genre: "Lista",
    genres: ["Lista"],
    poster: a.imagen_url || null,
    backdrop: null,
    desc: a.contenido || a.resumen || "",
    trailerUrl: null,
    tmdbId: "",
    justwatchUrl: ""
  };
}
function cardHTML(c) {
  var id = escHtml(c.id);
  var title = escHtml(c.title || "Sin título");
  var poster = mediaUrl(c.poster);
  var rating = escHtml(c.rating || "–");
  var year = escHtml(c.year || "");
  var badge = "PELÍCULA";
  if (c.esArticulo || c.type === "articulo") badge = "LISTA";
  else if (c.isEstreno) badge = "EN CINES";
  else if (c.type === "series" || c.type === "tv") badge = "SERIE";
  var fav = FAV.indexOf(c.id) !== -1;
  var media = poster
    ? '<img class="card-poster" alt="" src="' + escHtml(poster) + '" data-fallback="1" loading="lazy">'
    : '<div class="card-poster-placeholder">ELFILME</div>';
  var actions = "";
  if (!c.esArticulo && c.type !== "articulo") {
    actions = '<div class="card-actions"><button type="button" class="btn-tiny btn-tiny-red" data-action="trailer" data-id="' + id + '">Ver trailer</button><a class="btn-tiny" href="' + escHtml(c.justwatchUrl || justWatchUrl(c.title)) + '" target="_blank" rel="noopener">Dónde verla</a></div>';
  }
  return '<article class="card" tabindex="0" data-action="detail" data-id="' + id + '">' + media +
    '<span class="card-type-badge">' + badge + '</span>' +
    '<button type="button" class="card-fav' + (fav ? " active" : "") + '" data-action="fav" data-id="' + id + '" aria-label="Favorito">' + (fav ? "♥" : "♡") + '</button>' +
    '<div class="card-bottom"><h3 class="card-title-ov">' + title + '</h3><div class="card-meta-ov"><span class="card-rating">★ ' + rating + '</span><span>' + year + '</span></div>' + actions + '</div></article>';
}
function skeletonRows() {
  var card = '<div class="card skeleton"></div>';
  var row = "";
  for (var i = 0; i < 6; i++) row += card;
  return '<section class="row-section"><div class="section-header"><p class="section-kicker">Esta semana</p><h2 class="section-title-line">Tendencias</h2></div><div class="row-scroll">' + row + '</div></section>' +
    '<section class="row-section"><div class="section-header"><p class="section-kicker">Cartelera</p><h2 class="section-title-line">En cines</h2></div><div class="row-scroll">' + row + '</div></section>';
}
function matchGenre(c) {
  if (currentGenre === "All") return true;
  if (c.genre === currentGenre) return true;
  return (c.genres || []).indexOf(currentGenre) !== -1;
}
function sectionBlock(label, kicker, items, rowId) {
  return '<section class="row-section"' + (rowId ? ' id="' + rowId + '"' : "") + '><div class="section-header"><p class="section-kicker">' + escHtml(kicker) + '</p><h2 class="section-title-line">' + escHtml(label) + '</h2></div><div class="row-scroll">' + items.slice(0, 20).map(cardHTML).join("") + "</div></section>";
}
function renderGenreBar() {
  var set = {};
  DB.forEach(function (c) {
    if (c.genre) set[c.genre] = true;
    (c.genres || []).forEach(function (g) { if (g) set[g] = true; });
  });
  var names = Object.keys(set).sort();
  var html = '<button type="button" class="genre-pill' + (currentGenre === "All" ? " active" : "") + '" data-action="genre" data-genre="All">Todos</button>';
  names.forEach(function (name) {
    html += '<button type="button" class="genre-pill' + (name === currentGenre ? " active" : "") + '" data-action="genre" data-genre="' + escHtml(name) + '">' + escHtml(name) + "</button>";
  });
  document.getElementById("genreBar").innerHTML = html;
}
function renderHomeSections(skeleton) {
  var container = document.getElementById("sectionsContainer");
  var empty = document.getElementById("homeEmpty");
  if (skeleton) {
    container.innerHTML = skeletonRows();
    empty.hidden = true;
    return;
  }
  var html = "";
  var total = 0;
  var favs = DB.filter(function (c) { return FAV.indexOf(c.id) !== -1 && matchGenre(c); });
  if (favs.length) {
    html += sectionBlock("Favoritos", "Tu lista", favs, "row-favoritos");
    total += favs.length;
  }
  SECTIONS.forEach(function (sec) {
    var items = (DB_SECTIONS[sec.key] || []).filter(matchGenre);
    if (!items.length) return;
    total += items.length;
    html += sectionBlock(sec.label, sec.kicker, items);
  });
  container.innerHTML = html;
  empty.hidden = catalogPending || total !== 0;
  renderGenreBar();
  updateFavCount();
}
function pickFeatured() {
  var pools = [DB_SECTIONS.trending, DB_SECTIONS.estrenos, DB_SECTIONS.now_playing, DB_SECTIONS.resenas_elfilme, DB];
  for (var i = 0; i < pools.length; i++) {
    var list = pools[i] || [];
    for (var j = 0; j < list.length; j++) if (list[j] && list[j].title) return list[j];
  }
  return null;
}
function paintHero(c) {
  var copy = '<div class="hero-copy"><p class="hero-kicker">Destacado</p><h1 class="hero-title">' + escHtml(c.title) + '</h1><div class="hero-meta"><span class="rating">★ ' + escHtml(c.rating || "–") + '</span><span>' + escHtml(c.year || "") + '</span><span>' + escHtml(c.genre || "") + '</span></div><p class="hero-overview">' + escHtml(clip(c.desc, 180)) + '</p><div class="hero-actions">';
  if (!c.esArticulo && c.type !== "articulo") {
    copy += '<button type="button" class="btn-trailer" data-action="trailer" data-id="' + escHtml(c.id) + '">Ver trailer</button>';
    copy += '<a class="btn-ghost" href="' + escHtml(c.justwatchUrl || justWatchUrl(c.title)) + '" target="_blank" rel="noopener">Dónde verla</a>';
  }
  copy += '<button type="button" class="btn-ghost" data-action="detail" data-id="' + escHtml(c.id) + '">Más info</button></div></div>';
  var poster = asCssUrl(mediaUrl(c.poster));
  if (poster) copy += '<img class="hero-still" alt="" src="' + escHtml(poster) + '" data-fallback="1">';
  document.getElementById("heroContent").innerHTML = copy;
  var bg = asCssUrl(mediaUrl(c.backdrop || c.poster));
  document.getElementById("heroBg").style.backgroundImage = bg ? 'url("' + bg + '")' : "none";
}
function renderHero(force) {
  var featured = pickFeatured();
  if (!featured) return;
  if (heroLocked && !force) return;
  if ((DB_SECTIONS.trending || []).length) heroLocked = true;
  paintHero(featured);
}
function paintEmptyHero() {
  document.getElementById("heroContent").innerHTML = '<div class="hero-copy"><p class="hero-kicker">ElFilme</p><h1 class="hero-title">No pudimos cargar el catálogo</h1><p class="hero-overview">Revisa tu conexión e inténtalo de nuevo.</p><button type="button" class="btn-trailer" data-action="retry">Reintentar</button></div>';
}
function loadEstrenosBanner(list) {
  var pelis = Array.isArray(list) ? list : [];
  if (!pelis.length) return;
  var feat = pelis[0];
  document.getElementById("estrenosTitle").textContent = feat.title || "En cines";
  document.getElementById("estrenosCount").textContent = String(pelis.length);
  var poster = asCssUrl(mediaUrl(feat.poster));
  if (poster) {
    document.getElementById("estrenosBg").style.backgroundImage = 'url("' + poster + '")';
    var img = document.getElementById("estrenosPosterImg");
    img.hidden = false;
    img.src = poster;
    img.alt = feat.title || "Estreno";
  }
  var titles = pelis.slice(0, 10).map(function (p) { return p.title || ""; }).filter(Boolean).join("   ·   ");
  document.getElementById("estrenosTicker").textContent = titles;
}
function openDetail(id) {
  var c = findCard(id);
  if (!c) return;
  currentDetail = c;
  var poster = mediaUrl(c.poster);
  document.getElementById("detailPoster").innerHTML = poster ? '<img alt="" src="' + escHtml(poster) + '" data-fallback="1">' : '<div class="detail-poster-ph">ELFILME</div>';
  var bg = asCssUrl(mediaUrl(c.backdrop || c.poster));
  document.getElementById("detailHeroBg").style.backgroundImage = bg ? 'url("' + bg + '")' : "none";
  document.getElementById("detailTitle").textContent = c.title || "";
  document.getElementById("detailTagline").textContent = c.tagline || "";
  document.getElementById("detailMeta").innerHTML = '<span class="rating">★ ' + escHtml(c.rating || "–") + '</span><span>' + escHtml(c.year || "") + '</span><span>' + escHtml(c.type === "series" ? "Serie" : (c.esArticulo ? "Lista" : "Película")) + "</span>";
  document.getElementById("detailGenres").innerHTML = (c.genres || []).slice(0, 4).map(function (g) { return '<span class="genre-tag">' + escHtml(g) + "</span>"; }).join("");
  document.getElementById("detailDesc").textContent = c.desc || "";
  document.getElementById("detailBtns").innerHTML = detailActions(c);
  paintPlayer(c);
  var related = DB.filter(function (x) { return x.id !== c.id && (x.genre === c.genre || x.type === c.type); }).slice(0, 10);
  var rs = document.getElementById("relatedSection");
  if (related.length) {
    rs.hidden = false;
    document.getElementById("relatedGrid").innerHTML = related.map(cardHTML).join("");
  } else rs.hidden = true;
  if (isDigits(c.tmdbId)) { loadRatings(c.tmdbId); trackHistory(c); }
  else document.getElementById("ratingsSection").innerHTML = "";
  showPage("detail");
}
function detailActions(c) {
  var id = escHtml(c.id);
  var fav = FAV.indexOf(c.id) !== -1;
  var html = "";
  if (!c.esArticulo && c.type !== "articulo") {
    html += '<button type="button" class="btn-trailer" data-action="trailer" data-id="' + id + '">Ver trailer</button>';
    html += '<a class="btn-ghost" href="' + escHtml(c.justwatchUrl || justWatchUrl(c.title)) + '" target="_blank" rel="noopener">Dónde verla</a>';
  }
  html += '<button type="button" class="btn-ghost" data-action="fav" data-id="' + id + '">' + (fav ? "En favoritos" : "Favorito") + "</button>";
  html += '<button type="button" class="btn-ghost" data-action="go-home">Volver</button>';
  return html;
}
function paintPlayer(card) {
  var section = document.getElementById("playerSection");
  var wrap = document.getElementById("playerWrap");
  if (card.esArticulo || card.type === "articulo") {
    section.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  section.hidden = false;
  wrap.innerHTML = '<div class="trailer-empty"><div class="spinner"></div><p>Buscando trailer…</p></div>';
  var token = String(card.id);
  ensureTrailer(card).then(function (yt) {
    if (!currentDetail || String(currentDetail.id) !== token) return;
    var frame = trailerFrame(yt, false);
    wrap.innerHTML = frame || emptyTrailerHtml("No hay trailer disponible", "Puedes buscar dónde verla en una plataforma legal.");
  }).catch(function () {
    if (!currentDetail || String(currentDetail.id) !== token) return;
    wrap.innerHTML = emptyTrailerHtml("No hay trailer disponible", "No pudimos cargar el video.");
  });
}
function toggleFav(el) {
  var id = el.getAttribute("data-id");
  var card = findCard(id);
  var key = card ? card.id : id;
  var on = FAV.indexOf(key) === -1;
  if (on) FAV.push(key);
  else FAV = FAV.filter(function (x) { return x !== key; });
  try { localStorage.setItem("elfilme_fav", JSON.stringify(FAV)); } catch (e) {}
  updateFavCount();
  var nodes = document.querySelectorAll("[data-action='fav']");
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute("data-id") !== String(key)) continue;
    if (nodes[i].classList.contains("card-fav")) {
      nodes[i].textContent = on ? "♥" : "♡";
      nodes[i].classList.toggle("active", on);
    } else nodes[i].textContent = on ? "En favoritos" : "Favorito";
  }
  toast(on ? "Guardado en favoritos" : "Eliminado de favoritos");
  if (document.getElementById("page-favorites").classList.contains("active")) showFavorites();
  if (document.getElementById("page-home").classList.contains("active") && (on || !FAV.length)) renderHomeSections(false);
}
function showFavorites() {
  var favs = DB.filter(function (c) { return FAV.indexOf(c.id) !== -1; });
  document.getElementById("favsGrid").innerHTML = favs.map(cardHTML).join("");
  document.getElementById("favsEmpty").hidden = favs.length !== 0;
  showPage("favorites");
}
function liveSearch(q) {
  clearTimeout(searchTimer);
  if (!String(q || "").trim()) return;
  searchTimer = setTimeout(function () { doSearch(q); }, 320);
}
function doSearch(q) {
  var query = String(q || "").trim();
  if (!query) return;
  var needle = query.toLowerCase();
  var results = DB.filter(function (c) {
    return String(c.title || "").toLowerCase().indexOf(needle) !== -1 || String(c.genre || "").toLowerCase().indexOf(needle) !== -1 || String(c.desc || "").toLowerCase().indexOf(needle) !== -1;
  });
  document.getElementById("searchQueryDisplay").textContent = query;
  document.getElementById("searchCountDisplay").textContent = results.length + (results.length === 1 ? " resultado" : " resultados");
  document.getElementById("searchGrid").innerHTML = results.map(cardHTML).join("");
  document.getElementById("searchEmpty").hidden = results.length !== 0;
  showPage("search");
}
function closeMenu() {
  document.getElementById("sideMenu").classList.remove("open");
  document.getElementById("menuOverlay").classList.remove("open");
  document.body.style.overflow = "";
  if (menuUnbind) { menuUnbind(); menuUnbind = null; }
}
function toggleMenu() {
  var menu = document.getElementById("sideMenu");
  var open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  document.getElementById("menuOverlay").classList.toggle("open", open);
  document.body.style.overflow = open ? "hidden" : "";
  if (menuUnbind) { menuUnbind(); menuUnbind = null; }
  if (open) menuUnbind = bindDialogKeys(menu, closeMenu);
}
function toggleMobileSearch() {
  var bar = document.getElementById("mobileSearchBar");
  if (bar.hasAttribute("hidden")) {
    bar.removeAttribute("hidden");
    document.getElementById("headerSearchMob").focus();
  } else bar.setAttribute("hidden", "");
}
function openInfo(el) {
  var name = el.getAttribute("data-modal");
  var modal = document.getElementById("modal-" + name);
  if (!modal) return;
  dialogFocus = document.activeElement;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  if (infoUnbind) infoUnbind();
  infoUnbind = bindDialogKeys(modal.querySelector(".modal") || modal, function () { closeInfo(name); });
  var btn = modal.querySelector("[data-action='close-info']");
  if (btn) btn.focus();
}
function closeInfo(name) {
  var modal = document.getElementById("modal-" + name);
  if (modal) modal.classList.remove("open");
  document.body.style.overflow = "";
  if (infoUnbind) { infoUnbind(); infoUnbind = null; }
  if (dialogFocus && dialogFocus.focus) dialogFocus.focus();
}
function openRequest() {
  dialogFocus = document.activeElement;
  document.getElementById("requestModal").classList.add("open");
  document.body.style.overflow = "hidden";
  if (reqUnbind) reqUnbind();
  reqUnbind = bindDialogKeys(document.querySelector(".req-box"), closeRequest);
  document.getElementById("reqTitle").focus();
}
function closeRequest() {
  var modal = document.getElementById("requestModal");
  modal.classList.remove("open");
  document.body.style.overflow = "";
  if (reqUnbind) { reqUnbind(); reqUnbind = null; }
  if (dialogFocus && dialogFocus.focus) dialogFocus.focus();
}
function submitRequest() {
  var title = document.getElementById("reqTitle").value.trim();
  if (!title) { toast("Escribe el título"); return; }
  fetch("/api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title, year: document.getElementById("reqYear").value, notes: document.getElementById("reqNotes").value }) })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) { toast("Solicitud enviada"); closeRequest(); document.getElementById("reqTitle").value = ""; document.getElementById("reqYear").value = ""; document.getElementById("reqNotes").value = ""; }
      else toast(d.error || "No se pudo enviar");
    })
    .catch(function () { toast("No se pudo enviar"); });
}
function toggleLike() {
  var btn = document.getElementById("likeBtn");
  var liked = btn.classList.toggle("liked");
  document.getElementById("likeBtnText").textContent = liked ? "Te gusta" : "Me gusta";
}
function loadRatings(tmdbId) {
  var box = document.getElementById("ratingsSection");
  fetch("/api/ratings/" + encodeURIComponent(tmdbId)).then(function (r) { return r.json(); }).then(function (d) {
    if (!currentDetail || String(currentDetail.tmdbId) !== String(tmdbId)) return;
    var mine = d.mine && d.mine.stars ? Number(d.mine.stars) : 0;
    var stars = "";
    for (var n = 1; n <= 5; n++) stars += '<button type="button" class="star-btn' + (n <= mine ? " on" : "") + '" data-action="rate" data-stars="' + n + '" aria-label="' + n + ' estrellas">' + (n <= mine ? "★" : "☆") + "</button>";
    box.innerHTML = '<div class="rating-box"><div class="hero-meta"><strong class="rating">' + escHtml(d.avg || "–") + '</strong><span>' + escHtml(d.total || 0) + " calificaciones</span></div><div>" + stars + '</div><textarea id="reviewInput" rows="2" placeholder="Escribe una reseña (opcional)"></textarea></div>';
    if (d.mine && d.mine.review) document.getElementById("reviewInput").value = d.mine.review;
  }).catch(function () {});
}
function submitRating(el) {
  if (!currentDetail || !isDigits(currentDetail.tmdbId)) { toast("Esta ficha no admite calificación"); return; }
  var stars = Number(el.getAttribute("data-stars"));
  var reviewEl = document.getElementById("reviewInput");
  var review = reviewEl ? reviewEl.value : "";
  fetch("/api/ratings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tmdb_id: currentDetail.tmdbId, movie_title: currentDetail.title, stars: stars, review: review }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d.ok) { toast("Calificación guardada"); loadRatings(currentDetail.tmdbId); } else toast(d.error || "Error"); })
    .catch(function () { toast("No se pudo guardar"); });
}
function trackHistory(card) {
  fetch("/api/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tmdb_id: card.tmdbId, title: card.title, poster_path: card.poster || "", type: card.type }) }).catch(function () {});
}
function fetchTMDB(endpoint, extra) {
  var url = "https://api.themoviedb.org/3" + endpoint + "?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=es-MX&page=1" + (extra || "");
  return fetch(url).then(function (res) {
    if (!res.ok) return [];
    return res.json().then(function (data) { return data.results || []; });
  }).catch(function () { return []; });
}
function fetchJSON(url) {
  return fetch(url).then(function (r) { return r.json(); }).catch(function () { return {}; });
}
function readCache() {
  try {
    var raw = localStorage.getItem("elfilme_db_cache_v2");
    if (!raw) return null;
    var cached = JSON.parse(raw);
    if (!cached || !cached.sections || Date.now() - cached.ts > 30 * 60 * 1000) return null;
    return cached;
  } catch (e) { return null; }
}
function rebuildPool(sections) {
  CARD_POOL = {};
  DB = [];
  Object.keys(sections).forEach(function (key) {
    (sections[key] || []).forEach(function (card) {
      if (!card || !card.id) return;
      CARD_POOL[card.id] = card;
      remember(card);
    });
  });
}
function saveCache() {
  try { localStorage.setItem("elfilme_db_cache_v2", JSON.stringify({ ts: Date.now(), sections: DB_SECTIONS })); } catch (e) {}
}
function initDB() {
  showLoader(true);
  renderHomeSections(true);
  fetch("https://api.jsonbin.io/v3/b/" + ESTRENOS_BIN + "/latest", { headers: { "X-Master-Key": MASTER_KEY } })
    .then(function (res) { return res.ok ? res.json() : null; })
    .catch(function () { return null; })
    .then(function (payload) {
      var record = payload && payload.record;
      var raw = Array.isArray(record) ? record : (record && (record.peliculas || record.movies || record.estrenos)) || [];
      var estrenosDB = raw.map(estrenoToCard).filter(Boolean);
      DB_SECTIONS = { estrenos: estrenosDB };
      DB = [];
      estrenosDB.forEach(remember);
      showLoader(false);
      renderHomeSections(false);
      renderHero(false);
      loadEstrenosBanner(raw);
      var cached = readCache();
      if (cached && cached.sections && Object.keys(cached.sections).length > 1) {
        catalogPending = false;
        cached.sections.estrenos = estrenosDB;
        DB_SECTIONS = cached.sections;
        rebuildPool(DB_SECTIONS);
        renderHomeSections(false);
        renderHero(true);
        return;
      }
      return loadCatalog(estrenosDB);
    });
}
function loadCatalog(estrenosDB) {
  var jobs = [
    ["/trending/all/week", ""],
    ["/movie/popular", ""],
    ["/movie/top_rated", ""],
    ["/movie/now_playing", ""],
    ["/movie/upcoming", ""],
    ["/tv/popular", ""],
    ["/tv/top_rated", ""],
    ["/discover/movie", "&with_genres=28"],
    ["/discover/movie", "&with_genres=27"],
    ["/discover/movie", "&with_genres=16"],
    ["/discover/movie", "&with_genres=35"],
    ["/discover/movie", "&with_genres=18"],
    ["/discover/movie", "&with_genres=10749"],
    ["/discover/movie", "&with_genres=99"],
    ["/discover/tv", "&with_genres=16"],
    ["/discover/movie", "&with_original_language=es"]
  ];
  var ownUrls = [
    "/api/movies?categoria=resena&limit=20",
    "/api/articulos?tipo=top&limit=20",
    "/api/articulos?tipo=oscar&limit=20",
    "/api/articulos?tipo=peor&limit=20",
    "/api/articulos?tipo=streaming&limit=20",
    "/api/articulos?tipo=gratis_apps&limit=20"
  ];
  return Promise.all(jobs.map(function (job) { return fetchTMDB(job[0], job[1]); }).concat(ownUrls.map(fetchJSON))).then(function (all) {
    var lists = all.slice(0, jobs.length);
    var own = all.slice(jobs.length);
    var trending = mapTmdb(lists[0]);
    var sections = {
      estrenos: estrenosDB,
      resenas_elfilme: ((own[0] && own[0].movies) || []).map(ownMovieToCard),
      top_elfilme: ((own[1] && own[1].articulos) || []).map(articuloToCard),
      oscar_elfilme: ((own[2] && own[2].articulos) || []).map(articuloToCard),
      peor_elfilme: ((own[3] && own[3].articulos) || []).map(articuloToCard),
      streaming_elfilme: ((own[4] && own[4].articulos) || []).map(articuloToCard),
      gratis_elfilme: ((own[5] && own[5].articulos) || []).map(articuloToCard),
      trending: trending,
      now_playing: mapTmdb(lists[3], "movie"),
      popular: mapTmdb(lists[1], "movie"),
      top_rated: mapTmdb(lists[2], "movie"),
      upcoming: mapTmdb(lists[4], "movie"),
      series: mapTmdb(lists[5], "tv").concat(mapTmdb(lists[6], "tv")),
      accion: mapTmdb(lists[7], "movie"),
      terror: mapTmdb(lists[8], "movie"),
      animacion: mapTmdb(lists[9], "movie"),
      comedia: mapTmdb(lists[10], "movie"),
      drama: mapTmdb(lists[11], "movie"),
      romance: mapTmdb(lists[12], "movie"),
      documentales: mapTmdb(lists[13], "movie"),
      anime: mapTmdb(lists[14], "tv"),
      latino: mapTmdb(lists[15], "movie")
    };
    DB_SECTIONS = sections;
    rebuildPool(sections);
    catalogPending = false;
    if (!DB.length) paintEmptyHero();
    else {
      renderHomeSections(false);
      renderHero(true);
      saveCache();
    }
  }).catch(function () {
    catalogPending = false;
    if (!DB.length) paintEmptyHero();
    renderHomeSections(false);
  });
}
function goHome() {
  currentGenre = "All";
  renderHomeSections(false);
  showPage("home");
}

document.querySelectorAll(".modal-overlay").forEach(function (modal) {
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeInfo(modal.id.replace("modal-", ""));
  });
});
document.getElementById("requestModal").addEventListener("click", function (e) {
  if (e.target.id === "requestModal") closeRequest();
});
var trailers = createTrailerController({ resolve: ensureTrailer });
installImageFallback();
delegateActions({
  "go-home": function () { goHome(); },
  "go-estrenos": function () { location.href = "/estrenos"; },
  "toggle-menu": function () { toggleMenu(); },
  "close-menu": function () { closeMenu(); },
  "toggle-search": function () { toggleMobileSearch(); },
  "show-favs": function () { showFavorites(); },
  "open-request": function () { closeMenu(); openRequest(); },
  "close-request": function () { closeRequest(); },
  "submit-request": function () { submitRequest(); },
  "open-info": function (el) { closeMenu(); openInfo(el); },
  "close-info": function (el) { closeInfo(el.getAttribute("data-modal")); },
  genre: function (el) { currentGenre = el.getAttribute("data-genre") || "All"; renderHomeSections(false); },
  trailer: function (el) { var c = findCard(el.getAttribute("data-id")); if (c) trailers.open(c); },
  detail: function (el) { openDetail(el.getAttribute("data-id")); },
  fav: function (el) { toggleFav(el); },
  rate: function (el) { submitRating(el); },
  like: function () { toggleLike(); },
  retry: function () { heroLocked = false; initDB(); }
});
initDB();
`;

const INDEX_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#070708">
<title>ElFilme — Tu cine VIP</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet">
<style>${CINE_CSS}${HOME_CSS}</style>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8048005026767909" crossorigin="anonymous"></script>
<script>(adsbygoogle = window.adsbygoogle || []).push({google_ad_client: "ca-pub-8048005026767909", enable_page_level_ads: true});</script>
</head>
<body>
<div id="loader" class="loader-bar" hidden></div>
<header>
  <button class="logo" type="button" data-action="go-home" aria-label="ElFilme, inicio"><span class="wordmark">EL<span>FILME</span></span></button>
  <div class="header-search-desktop"><input id="headerSearchDesk" type="search" placeholder="Buscar películas, series…" oninput="liveSearch(this.value)" onkeydown="if (event.key === 'Enter') doSearch(this.value)"></div>
  <nav class="desktop-nav" aria-label="Principal">
    <button type="button" data-action="go-home">Inicio</button>
    <a class="is-hot" href="/estrenos">En cines</a>
    <a href="/noticiero">Noticiero</a>
    <button type="button" data-action="show-favs">Favoritos <span id="favCountDesk">0</span></button>
    <button type="button" data-action="open-info" data-modal="contact">Contacto</button>
  </nav>
  <div class="header-tools">
    <button class="search-icon-btn" type="button" data-action="toggle-search" aria-label="Buscar">⌕</button>
    <button class="fav-btn" type="button" data-action="show-favs" aria-label="Favoritos">♥ <span class="fav-count" id="favCount">0</span></button>
    <button class="hamburger" type="button" data-action="toggle-menu" aria-label="Menú"><span></span><span></span><span></span></button>
  </div>
</header>
<div class="header-search-bar" id="mobileSearchBar" hidden><input id="headerSearchMob" type="search" placeholder="Buscar películas, series…" oninput="liveSearch(this.value)" onkeydown="if (event.key === 'Enter') doSearch(this.value)"></div>
<div class="wide-banner"><img src="${LOGO_URL}" alt="ElFilme.com — Tu cine VIP" onerror="this.parentElement.style.display='none'"></div>
<div class="menu-overlay" id="menuOverlay" data-action="close-menu"></div>
<nav class="side-menu" id="sideMenu" aria-label="Menú">
  <div class="menu-section-label">Navegación</div>
  <button class="menu-item" type="button" data-action="go-home">Inicio</button>
  <button class="menu-item" type="button" data-action="show-favs">Favoritos <span id="favCountMenu">0</span></button>
  <button class="menu-item" type="button" data-action="open-request">Solicitar película</button>
  <div class="menu-section-label">Contenido</div>
  <a class="menu-item" href="/estrenos">En cines</a>
  <a class="menu-item" href="/noticiero">Noticiero</a>
  <button class="menu-item" type="button" data-action="open-info" data-modal="contact">Contacto</button>
  <button class="menu-item" type="button" data-action="open-info" data-modal="terms">Términos</button>
</nav>
<div class="vip-banner">ACCESO LIBRE · ELFILME.COM · TU CINE VIP</div>
<div class="estrenos-banner" data-action="go-estrenos">
  <div class="estrenos-banner-bg" id="estrenosBg"></div>
  <div class="estrenos-banner-overlay"></div>
  <div class="estrenos-banner-content">
    <div class="estrenos-poster-thumb"><img id="estrenosPosterImg" alt="" hidden></div>
    <div class="estrenos-text">
      <div class="estrenos-badge-row"><span class="now-playing-badge">EN CINES</span><span class="estrenos-label-badge">ESTRENOS VIP</span></div>
      <div class="estrenos-title" id="estrenosTitle">Cargando cartelera…</div>
      <div class="estrenos-subtitle" id="estrenosSubtitle">Cartelera exclusiva ElFilme</div>
      <a class="btn-tiny btn-tiny-red" href="/estrenos">Ver cartelera completa</a>
    </div>
    <div class="estrenos-count-badge"><div class="estrenos-count-num" id="estrenosCount">–</div><div class="estrenos-count-label">ESTRENOS</div></div>
  </div>
  <div class="estrenos-ticker" id="estrenosTicker">Estrenos en cartelera · ElFilme</div>
</div>
<main>
  <div class="page active" id="page-home">
    <section class="hero" id="heroSection">
      <div class="hero-bg" id="heroBg"></div>
      <div class="hero-overlay"></div>
      <div class="hero-content" id="heroContent"><p class="hero-kicker">Destacado</p><h1 class="hero-title">Cargando cartelera…</h1></div>
    </section>
    <div class="genre-bar" id="genreBar"><button type="button" class="genre-pill active" data-action="genre" data-genre="All">Todos</button></div>
    <div id="sectionsContainer"></div>
    <div class="empty-state" id="homeEmpty" hidden><div class="empty-title">Sin contenido</div><p>No hay títulos para este filtro.</p></div>
  </div>
  <div class="page" id="page-detail">
    <div class="detail-hero">
      <div class="detail-hero-bg" id="detailHeroBg"></div>
      <div class="detail-overlay"></div>
      <div class="detail-content">
        <div class="detail-row">
          <div class="detail-poster" id="detailPoster"></div>
          <div>
            <h1 class="detail-title" id="detailTitle"></h1>
            <p class="detail-tagline" id="detailTagline"></p>
            <div class="detail-meta" id="detailMeta"></div>
            <div class="genre-tags" id="detailGenres"></div>
          </div>
        </div>
        <p class="detail-desc" id="detailDesc"></p>
        <div class="detail-btns" id="detailBtns"></div>
      </div>
    </div>
    <section class="player-section" id="playerSection" hidden>
      <p class="section-kicker">YouTube</p>
      <h2 class="section-title-line">Trailer</h2>
      <div class="player-wrap" id="playerWrap"></div>
      <div class="likes-bar"><button type="button" class="like-btn" id="likeBtn" data-action="like"><span id="likeBtnText">Me gusta</span></button></div>
    </section>
    <div id="ratingsSection" style="width:min(1100px,100%);margin:0 auto;padding:0 1.15rem 1rem"></div>
    <div style="width:min(1100px,100%);margin:0 auto;padding:0 1.15rem .6rem"><button type="button" class="btn-tiny" data-action="open-request">Solicitar una película</button></div>
    <section class="row-section" id="relatedSection" hidden>
      <div class="section-header"><p class="section-kicker">También</p><h2 class="section-title-line">También te puede gustar</h2></div>
      <div class="row-scroll" id="relatedGrid"></div>
    </section>
  </div>
  <div class="page" id="page-favorites">
    <div style="padding:1.4rem 1.15rem">
      <div class="section-header"><p class="section-kicker">Tu lista</p><h2 class="section-title-line">Favoritos</h2></div>
      <div class="cards-grid" id="favsGrid"></div>
      <div class="empty-state" id="favsEmpty" hidden><div class="empty-title">Aún no hay favoritos</div><p>Marca un título con el corazón para guardarlo en este dispositivo.</p></div>
    </div>
  </div>
  <div class="page" id="page-search">
    <div class="search-header"><div class="search-query">Resultados para <span id="searchQueryDisplay"></span></div><div class="search-count" id="searchCountDisplay"></div></div>
    <div style="padding:1rem 1.15rem"><div class="cards-grid" id="searchGrid"></div><div class="empty-state" id="searchEmpty" hidden><div class="empty-title">Sin resultados</div></div></div>
  </div>
</main>
<div class="req-modal" id="requestModal">
  <div class="req-box" role="dialog" aria-modal="true" aria-labelledby="reqHeading">
    <h2 class="req-title" id="reqHeading">Solicitar película</h2>
    <p class="req-sub">Pide un título y lo revisaremos.</p>
    <input class="form-input" id="reqTitle" placeholder="Título de la película o serie">
    <input class="form-input" id="reqYear" placeholder="Año (opcional)" inputmode="numeric" style="margin-top:.55rem">
    <textarea id="reqNotes" rows="3" placeholder="Notas (opcional)" style="margin-top:.55rem"></textarea>
    <p class="req-sub">Máximo 3 solicitudes por día.</p>
    <div class="req-actions"><button type="button" class="btn-ghost" data-action="close-request">Cancelar</button><button type="button" class="btn-trailer" data-action="submit-request">Enviar</button></div>
  </div>
</div>
<div class="modal-overlay" id="modal-contact">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="contactTitle">
    <div class="modal-header"><h2 class="modal-title" id="contactTitle">Contacto</h2><button type="button" class="modal-close" data-action="close-info" data-modal="contact" aria-label="Cerrar">×</button></div>
    <div class="modal-body"><p class="section-kicker">Email</p><p style="margin:.3rem 0 .8rem">contacto@elfilme.com</p><p class="section-kicker">Sitio</p><p><a href="https://elfilme.com">elfilme.com</a></p></div>
  </div>
</div>
<div class="modal-overlay" id="modal-terms">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="termsTitle">
    <div class="modal-header"><h2 class="modal-title" id="termsTitle">Términos y condiciones</h2><button type="button" class="modal-close" data-action="close-info" data-modal="terms" aria-label="Cerrar">×</button></div>
    <div class="modal-body"><p><strong>Última actualización: 2026</strong></p><p style="margin-top:.7rem">ElFilme.com es un sitio de reseñas y noticias de cine. No aloja ni transmite películas: te ayudamos a encontrar dónde verlas legalmente en plataformas autorizadas.</p></div>
  </div>
</div>
${trailerModalMarkup()}
<footer>
  <div class="footer-logo"><img src="${LOGO_URL}" alt="ElFilme" onerror="this.style.display='none'"></div>
  <div class="footer-links">
    <button type="button" data-action="open-info" data-modal="contact">Contacto</button>
    <button type="button" data-action="open-info" data-modal="terms">Términos</button>
    <a href="/estrenos">En cines</a>
    <a href="/noticiero">Noticiero</a>
  </div>
  <p class="footer-disclaimer">ElFilme.com es un sitio de reseñas y noticias de cine. Te ayudamos a encontrar dónde ver películas legalmente.</p>
  <p class="footer-copy">2026 ElFilme.com · SYNAPT Network · San Jose, CA</p>
  ${SYNAPT_FOOTER}
  ${COFFEE}
</footer>
<div class="toast" id="toast" role="status"></div>
<script>
${SHARED_BROWSER}
const TMDB_KEY = ${JSON.stringify(TMDB_KEY_DEFAULT)};
const MASTER_KEY = ${JSON.stringify(JSONBIN_MASTER_KEY_DEFAULT)};
const ESTRENOS_BIN = ${JSON.stringify(ESTRENOS_BIN)};
${HOME_JS}
</script>
</body>
</html>`;
const SUB_CSS = `
body{margin:0;}
.subhead{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1rem;background:rgba(7,7,8,.92);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.06);}
.subhead a{color:var(--muted);text-decoration:none;}
.hero-block{position:relative;min-height:420px;display:flex;align-items:flex-end;background:#14080b center/cover no-repeat;}
.hero-block .shade{position:absolute;inset:0;background:linear-gradient(to top,#070708,rgba(7,7,8,.2));}
.hero-block .copy{position:relative;padding:1.4rem 1rem 1.6rem;width:min(1000px,100%);}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;padding:0 1rem 1.4rem;}
.movie-card{background:#121218;border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;}
.movie-card .poster{width:100%;aspect-ratio:2/3;object-fit:cover;background:#1b1b22;}
.movie-body{padding:.75rem .75rem .85rem;display:flex;flex-direction:column;gap:.45rem;}
.movie-body h3{font-size:.95rem;line-height:1.25;}
.section{padding:1rem 0 0;}
.section h2{font-family:var(--display);letter-spacing:.08em;font-size:1.8rem;margin:0 1rem .7rem;display:flex;align-items:center;gap:.7rem;}
.section h2::after{content:"";height:1px;flex:1;background:linear-gradient(90deg,rgba(229,9,20,.75),transparent);}
.hero-title{font-family:var(--serif);font-size:clamp(2.2rem,6vw,4.4rem);line-height:.95;margin:.2rem 0 .6rem;}
.hero-overview{color:#ddd7cf;max-width:62ch;margin-bottom:.8rem;}
.hero-actions{display:flex;flex-wrap:wrap;gap:.6rem;}
.section-kicker{color:var(--accent);letter-spacing:.16em;text-transform:uppercase;font-size:.72rem;font-weight:700;}
.card-rating{color:var(--gold);font-weight:700;}
.empty-state{text-align:center;padding:2rem 1rem;color:var(--muted);}
.empty-title{font-family:var(--serif);color:#fff;font-size:1.4rem;margin-bottom:.3rem;}
.card-poster-placeholder{min-height:180px;}
.news-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;padding:0 1rem 1.5rem;}
.news-card{display:flex;flex-direction:column;background:#121218;border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;min-height:100%;}
.news-card img,.news-ph{width:100%;height:160px;object-fit:cover;background:#1b1b22;}
.news-ph{display:grid;place-items:center;color:var(--faint);font-family:var(--display);}
.news-card div{padding:.9rem;}
.news-card strong{display:block;font-family:var(--serif);font-size:1.05rem;margin:.25rem 0;}
.ticker{background:var(--accent);color:#fff;overflow:hidden;white-space:nowrap;padding:.4rem 0;font-size:.82rem;}
.info-modal{position:fixed;inset:0;z-index:55;display:none;align-items:flex-end;justify-content:center;}
.info-modal.open{display:flex;}
.info-dialog{position:relative;width:min(860px,100%);max-height:min(92vh,900px);overflow:auto;background:#101014;border:1px solid rgba(255,255,255,.1);border-radius:18px 18px 0 0;padding:1rem;}
.info-dialog img.wide{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;background:#000;}
.stage-inline{position:relative;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden;margin:.8rem 0;}
.stage-inline iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
@media(min-width:840px){.info-modal.open{align-items:center;padding:1.2rem;}.info-dialog{border-radius:18px;}}
@media(max-width:640px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
`;

const ESTRENOS_JS = `
var ESTR = [];
var trailers = createTrailerController({ resolve: ensureTrailer });
installImageFallback();
function asList(record) {
  if (Array.isArray(record)) return record;
  if (record && Array.isArray(record.peliculas)) return record.peliculas;
  if (record && Array.isArray(record.movies)) return record.movies;
  if (record && Array.isArray(record.estrenos)) return record.estrenos;
  return [];
}
function mapItem(p, index) {
  var title = (p && p.title) || "Estreno";
  return {
    title: title,
    poster: (p && p.poster) || "",
    backdrop: (p && (p.backdrop || p.poster)) || "",
    overview: (p && (p.overview || p.description)) || "",
    category: (p && p.category) || "En cines",
    rating: p && p.vote_average ? Number(p.vote_average).toFixed(1) : "",
    trailerUrl: extractYouTubeId((p && (p.trailer || p.trailer_url || p.trailerUrl || p.youtube || p.youtube_id || p.video)) || ""),
    tmdbId: (p && (p.tmdb_id || p.tmdbId || p.tmdb)) || "",
    type: "movie",
    watchUrl: justWatchUrl(title),
    justwatchUrl: justWatchUrl(title),
    index: index
  };
}
function setHeroActions(visible) {
  var actions = document.getElementById("heroActions");
  if (!actions) return;
  if (visible) actions.removeAttribute("hidden");
  else actions.setAttribute("hidden", "");
}
function showCatalogMessage(title, text) {
  document.getElementById("heroTitle").textContent = title;
  document.getElementById("heroText").textContent = text;
  document.getElementById("hero").style.backgroundImage = "none";
  setHeroActions(false);
}
function feature(item) {
  var hero = document.getElementById("hero");
  var bg = mediaUrl(item.backdrop || item.poster);
  hero.style.backgroundImage = bg ? 'url("' + bg + '")' : "none";
  document.getElementById("heroTitle").textContent = item.title;
  document.getElementById("heroText").textContent = item.overview || "En cartelera.";
  document.getElementById("heroWatch").href = item.watchUrl;
  document.getElementById("heroTrailer").setAttribute("data-index", String(item.index));
  setHeroActions(true);
}
function card(item) {
  var poster = mediaUrl(item.poster);
  var img = poster ? '<img class="poster" alt="" src="' + escHtml(poster) + '" data-fallback="1" loading="lazy">' : '<div class="card-poster-placeholder">ELFILME</div>';
  return '<article class="movie-card">' + img + '<div class="movie-body"><h3>' + escHtml(item.title) + '</h3>' +
    (item.rating ? '<p class="card-rating">★ ' + escHtml(item.rating) + '</p>' : '') +
    '<div class="card-actions"><button type="button" class="btn-tiny btn-tiny-red" data-action="trailer" data-index="' + item.index + '">Ver trailer</button>' +
    '<a class="btn-tiny" href="' + escHtml(item.watchUrl) + '" target="_blank" rel="noopener">Dónde verla</a></div></div></article>';
}
function render(list) {
  var root = document.getElementById("cats");
  if (!list.length) {
    showCatalogMessage("Sin estrenos", "Vuelve pronto. La cartelera se actualiza desde ElFilme.");
    root.innerHTML = '<div class="empty-state"><div class="empty-title">Sin estrenos</div><p>Vuelve pronto.</p></div>';
    return;
  }
  feature(list[0]);
  var cats = [];
  list.forEach(function (item) { if (cats.indexOf(item.category) === -1) cats.push(item.category); });
  root.innerHTML = cats.map(function (cat) {
    var items = list.filter(function (item) { return item.category === cat; });
    return '<section class="section"><h2>' + escHtml(cat) + '</h2><div class="grid">' + items.map(card).join("") + "</div></section>";
  }).join("");
}
delegateActions({
  trailer: function (el) {
    var item = ESTR[Number(el.getAttribute("data-index"))];
    if (item) trailers.open(item);
  }
});
fetch("https://api.jsonbin.io/v3/b/" + BIN_ID + "/latest", { headers: { "X-Master-Key": MASTER_KEY } })
  .then(function (res) { if (!res.ok) throw new Error("bin"); return res.json(); })
  .then(function (data) {
    ESTR = asList(data.record).map(mapItem);
    render(ESTR);
  })
  .catch(function () {
    showCatalogMessage("Cartelera no disponible", "No pudimos cargar los estrenos. Inténtalo de nuevo en unos minutos.");
    document.getElementById("cats").innerHTML = '<div class="empty-state"><div class="empty-title">No se pudo cargar la cartelera</div><p>Inténtalo de nuevo en unos minutos.</p></div>';
  });
`;

const ESTRENOS_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>En cines — ElFilme</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;600;700&family=Playfair+Display:wght@600&display=swap" rel="stylesheet">
<style>${CINE_CSS}${SUB_CSS}</style>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8048005026767909" crossorigin="anonymous"></script>
<script>(adsbygoogle = window.adsbygoogle || []).push({google_ad_client: "ca-pub-8048005026767909", enable_page_level_ads: true});</script>
</head>
<body>
<header class="subhead">
  <a href="/" class="wordmark">EL<span>FILME</span></a>
  <a href="/">Volver</a>
</header>
<section class="hero-block" id="hero">
  <div class="shade"></div>
  <div class="copy">
    <p class="section-kicker">En cines</p>
    <h1 class="hero-title" id="heroTitle">Cargando…</h1>
    <p class="hero-overview" id="heroText">Cartelera ElFilme.</p>
    <div class="hero-actions" id="heroActions" hidden>
      <button type="button" class="btn-trailer" id="heroTrailer" data-action="trailer" data-index="0">Ver trailer</button>
      <a class="btn-ghost" id="heroWatch" href="https://www.justwatch.com/mx" target="_blank" rel="noopener">Dónde verla</a>
    </div>
  </div>
</section>
<div id="cats"></div>
${trailerModalMarkup()}
<footer>
  <img src="${LOGO_URL}" alt="ElFilme" style="height:52px" onerror="this.style.display='none'">
  <p class="footer-copy">2026 ElFilme.com · SYNAPT Network</p>
  ${SYNAPT_FOOTER}
</footer>
<script>
${SHARED_BROWSER}
const MASTER_KEY = ${JSON.stringify(JSONBIN_MASTER_KEY_DEFAULT)};
const BIN_ID = ${JSON.stringify(ESTRENOS_BIN)};
${ESTRENOS_JS}
</script>
</body>
</html>`;

const NOTICIERO_JS = `
var MOVIES = [];
var OWN = {};
var trailers = createTrailerController({ resolve: ensureTrailer });
var infoUnbind = null;
installImageFallback();
function asList(record) {
  if (!record) return null;
  if (Array.isArray(record)) return record;
  if (Array.isArray(record.movies)) return record.movies;
  return null;
}
function mapMovie(m) {
  var title = m.title || m.title_es || m.name || "Sin título";
  var tmdbId = m.tmdb_id || m.tmdbId || m.tmdb || "";
  if (!tmdbId && isDigits(m.id) && (m.poster || m.poster_path || m.overview || m.backdrop)) tmdbId = String(m.id);
  return {
    title: title,
    poster: m.poster || m.poster_path || "",
    backdrop: m.backdrop || m.backdrop_path || "",
    overview: m.overview || m.overview_es || m.description || "",
    rating: m.rating || (m.vote_average ? Number(m.vote_average).toFixed(1) : ""),
    year: String(m.releaseDate || m.release_date || "").slice(0, 4),
    trailerUrl: extractYouTubeId(m.trailer || m.trailer_url || m.youtube || ""),
    tmdbId: tmdbId,
    type: m.type === "tv" || m.media_type === "tv" ? "tv" : "movie",
    watchUrl: m.justwatchUrl || justWatchUrl(title),
    justwatchUrl: m.justwatchUrl || justWatchUrl(title)
  };
}
function movieCard(m, index, listName) {
  var poster = mediaUrl(m.poster);
  var list = listName || "main";
  var img = poster ? '<img class="poster" alt="" src="' + escHtml(poster) + '" data-fallback="1" loading="lazy">' : '<div class="card-poster-placeholder">ELFILME</div>';
  return '<article class="movie-card">' + img + '<div class="movie-body"><h3>' + escHtml(m.title) + '</h3><p class="card-rating">' + (m.rating ? "★ " + escHtml(m.rating) : "") + '</p><div class="card-actions">' +
    '<button type="button" class="btn-tiny btn-tiny-red" data-action="trailer" data-list="' + list + '" data-index="' + index + '">Ver trailer</button>' +
    '<a class="btn-tiny" href="' + escHtml(m.watchUrl) + '" target="_blank" rel="noopener">Dónde verla</a>' +
    '<button type="button" class="btn-tiny" data-action="info" data-list="' + list + '" data-index="' + index + '">Ficha</button></div></div></article>';
}
function itemFrom(el) {
  var listName = el.getAttribute("data-list") || "main";
  var index = Number(el.getAttribute("data-index"));
  var list = listName === "main" ? MOVIES : (OWN[listName] || []);
  return list[index];
}
function renderMovies(list) {
  MOVIES = list;
  document.getElementById("movieCount").textContent = list.length + " películas";
  var hero = list[0];
  var box = document.getElementById("hero");
  if (!hero) { box.innerHTML = ""; return; }
  var bg = mediaUrl(hero.backdrop || hero.poster);
  box.innerHTML = '<div class="shade"></div><div class="copy"><p class="section-kicker">Tendencias</p><h1 class="hero-title">' + escHtml(hero.title) + '</h1><p class="hero-overview">' + escHtml(String(hero.overview || "").slice(0, 280)) + '</p><div class="hero-actions"><button type="button" class="btn-trailer" data-action="trailer" data-list="main" data-index="0">Ver trailer</button><a class="btn-ghost" href="' + escHtml(hero.watchUrl) + '" target="_blank" rel="noopener">Dónde verla</a><button type="button" class="btn-ghost" data-action="info" data-list="main" data-index="0">Ficha</button></div></div>';
  if (bg) box.style.backgroundImage = 'url("' + bg + '")';
  document.getElementById("movieGrid").innerHTML = list.slice(1).map(function (m, i) { return movieCard(m, i + 1); }).join("") || '<p class="empty-state">Sin más títulos.</p>';
}
function renderNews(raw) {
  var news = (raw || []).map(function (n) {
    return { title: n.title || n.headline || "", description: n.description || n.snippet || n.resumen || "", url: n.url || n.link || "#", image: n.image || n.thumbnail || n.imagen_url || "", source: (n.source && n.source.name) || n.source || n.publisher || "ElFilme" };
  }).filter(function (n) { return n.title; });
  document.getElementById("newsCount").textContent = news.length + " noticias";
  var grid = document.getElementById("newsGrid");
  if (!news.length) { grid.innerHTML = '<p class="empty-state">Sin noticias disponibles.</p>'; return; }
  grid.innerHTML = news.map(function (n) {
    var img = mediaUrl(n.image);
    return '<a class="news-card" href="' + escHtml(n.url) + '" target="_blank" rel="noopener">' +
      (img ? '<img alt="" src="' + escHtml(img) + '" data-fallback="1">' : '<div class="news-ph">CINE</div>') +
      '<div><span class="section-kicker">' + escHtml(n.source) + '</span><strong>' + escHtml(n.title) + '</strong><p>' + escHtml(String(n.description || "").slice(0, 160)) + '</p></div></a>';
  }).join("");
}
function render(data) {
  var movies = (data.movies || []).map(mapMovie);
  renderMovies(movies);
  renderNews(data.news || []);
  var bits = movies.slice(0, 8).map(function (m) { return m.title; });
  document.getElementById("ticker").textContent = bits.join("   ·   ") || "ElFilme · Tu cine VIP";
}
function loadFromTMDB() {
  return fetch("https://api.themoviedb.org/3/trending/movie/week?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=es-MX")
    .then(function (r) { return r.json(); })
    .then(function (d) { render({ movies: d.results || [], news: [] }); })
    .catch(function () { document.getElementById("movieGrid").innerHTML = '<p class="empty-state">Error cargando datos.</p>'; });
}
function loadData() {
  fetch("https://api.jsonbin.io/v3/b/" + JSONBIN_ID + "/latest", { headers: { "X-Master-Key": JSONBIN_KEY } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (payload) {
      var record = payload && payload.record;
      var movies = asList(record);
      if (movies && movies.length) render({ movies: movies, news: (record && record.news) || [], updatedAt: record && record.updatedAt });
      else return loadFromTMDB();
    })
    .catch(function () { return loadFromTMDB(); });
}
function loadOwn() {
  var sections = [
    ["resena", "resenas"],
    ["top", "top"],
    ["oscar", "oscar"],
    ["peor", "peor"],
    ["streaming", "streaming"],
    ["gratis_apps", "gratis"]
  ];
  sections.forEach(function (pair) {
    fetch("/api/movies?categoria=" + pair[0] + "&limit=12").then(function (r) { return r.json(); }).then(function (d) {
      var grid = document.getElementById(pair[1]);
      var movies = ((d && d.movies) || []).map(function (m) {
        return mapMovie({ title: m.title_es || m.title, poster: m.poster_path, overview: m.overview_es || m.overview, rating: m.rating, release_date: m.release_date, tmdb_id: m.tmdb_id, trailer_url: m.trailer_url, type: "movie" });
      });
      if (!movies.length || !grid) return;
      OWN[pair[1]] = movies;
      grid.innerHTML = movies.map(function (m, i) { return movieCard(m, i, pair[1]); }).join("");
      grid.parentElement.hidden = false;
    }).catch(function () {});
  });
}
function openInfoItem(m) {
  if (!m) return;
  document.getElementById("infoTitle").textContent = m.title;
  document.getElementById("infoMeta").textContent = [m.rating ? "★ " + m.rating : "", m.year || ""].filter(Boolean).join(" · ");
  document.getElementById("infoOverview").textContent = m.overview || "";
  var img = document.getElementById("infoImg");
  var src = mediaUrl(m.backdrop || m.poster);
  if (src) { img.src = src; img.hidden = false; } else img.hidden = true;
  document.getElementById("infoWatch").href = m.watchUrl;
  var trailerBtn = document.getElementById("infoTrailer");
  trailerBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); trailers.open(m); };
  var stage = document.getElementById("infoStage");
  stage.innerHTML = '<div class="trailer-empty"><div class="spinner"></div><p>Buscando trailer…</p></div>';
  ensureTrailer(m).then(function (yt) {
    var frame = trailerFrame(yt, false);
    stage.innerHTML = frame || emptyTrailerHtml("No hay trailer disponible", "No encontramos un video de YouTube para este título.");
  });
  var modal = document.getElementById("infoModal");
  modal.classList.add("open");
  modal.removeAttribute("hidden");
  document.body.style.overflow = "hidden";
  if (infoUnbind) infoUnbind();
  infoUnbind = bindDialogKeys(document.querySelector(".info-dialog"), closeInfo);
}
function closeInfo() {
  var modal = document.getElementById("infoModal");
  modal.classList.remove("open");
  modal.setAttribute("hidden", "");
  document.getElementById("infoStage").innerHTML = "";
  document.body.style.overflow = "";
  if (infoUnbind) { infoUnbind(); infoUnbind = null; }
}
delegateActions({
  trailer: function (el) { var m = itemFrom(el); if (m) trailers.open(m); },
  info: function (el) { var m = itemFrom(el); if (m) openInfoItem(m); },
  "close-info": function () { closeInfo(); }
});
document.addEventListener("click", function (e) {
  if (e.target && e.target.id === "infoModal") closeInfo();
});
loadData();
loadOwn();
`;

const NOTICIERO_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Noticiero — ElFilme</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;600;700&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">
<style>${CINE_CSS}${SUB_CSS}</style>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8048005026767909" crossorigin="anonymous"></script>
<script>(adsbygoogle = window.adsbygoogle || []).push({google_ad_client: "ca-pub-8048005026767909", enable_page_level_ads: true});</script>
</head>
<body>
<header class="subhead">
  <a href="/" class="wordmark">EL<span>FILME</span></a>
  <span class="section-kicker">Actualización en vivo</span>
</header>
<div class="ticker" id="ticker">Cargando noticias…</div>
<section class="hero-block" id="hero"></section>
<section class="section"><h2>Tendencias <span id="movieCount" style="font-family:Outfit,sans-serif;font-size:.8rem;letter-spacing:0;color:var(--muted)"></span></h2><div class="grid" id="movieGrid"></div></section>
<section class="section" hidden><h2>Reseñas de ElFilme</h2><div class="grid" id="resenas"></div></section>
<section class="section" hidden><h2>Top películas</h2><div class="grid" id="top"></div></section>
<section class="section" hidden><h2>Ganadoras del Oscar</h2><div class="grid" id="oscar"></div></section>
<section class="section" hidden><h2>Las peores películas</h2><div class="grid" id="peor"></div></section>
<section class="section" hidden><h2>Dónde ver en streaming</h2><div class="grid" id="streaming"></div></section>
<section class="section" hidden><h2>Gratis en apps</h2><div class="grid" id="gratis"></div></section>
<section class="section"><h2>Noticias de cine <span id="newsCount" style="font-family:Outfit,sans-serif;font-size:.8rem;letter-spacing:0;color:var(--muted)"></span></h2><div class="news-grid" id="newsGrid"></div></section>
<div class="info-modal" id="infoModal" hidden>
  <div class="trailer-backdrop" data-action="close-info"></div>
  <div class="info-dialog" role="dialog" aria-modal="true" aria-labelledby="infoTitle">
    <button type="button" class="icon-btn" data-action="close-info" aria-label="Cerrar">×</button>
    <img class="wide" id="infoImg" alt="" hidden>
    <h2 id="infoTitle" class="hero-title" style="font-size:2rem;margin-top:.6rem"></h2>
    <p id="infoMeta" class="hero-meta"></p>
    <p id="infoOverview"></p>
    <div class="stage-inline" id="infoStage"></div>
    <div class="hero-actions"><button type="button" class="btn-trailer" id="infoTrailer" data-action="trailer">Ver trailer</button><a class="btn-ghost" id="infoWatch" target="_blank" rel="noopener" href="https://www.justwatch.com/mx">Dónde verla</a></div>
  </div>
</div>
${trailerModalMarkup()}
<footer>
  <img src="${LOGO_URL}" alt="ElFilme" style="height:48px" onerror="this.style.display='none'">
  <p class="footer-copy"><a href="/">ELFILME.COM</a> · Datos: TMDB</p>
  ${SYNAPT_FOOTER}
</footer>
<script>
${SHARED_BROWSER}
const JSONBIN_ID = ${JSON.stringify(NOTICIERO_BIN)};
const JSONBIN_KEY = ${JSON.stringify(JSONBIN_MASTER_KEY_DEFAULT)};
const TMDB_KEY = ${JSON.stringify(TMDB_KEY_DEFAULT)};
${NOTICIERO_JS}
</script>
</body>
</html>`;

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ElFilme 404</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070708;color:#f6f3ee;font-family:Outfit,sans-serif;text-align:center;padding:2rem}h1{font-size:5rem;color:#e50914;margin:0}a{color:#e50914;text-decoration:none}</style>
</head><body><div><h1>404</h1><p>Página no encontrada</p><p><a href="/">Volver a ElFilme</a></p>${SYNAPT_FOOTER}</div></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ads.txt") {
      return new Response("google.com, pub-8048005026767909, DIRECT, f08c47fec0942fa0\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" }
      });
    }
    const path = url.pathname.replace(/\/$/, "") || "/";
    const method = request.method;
    if (path.startsWith("/api/")) return handleAPI(path, method, request, env);
    if (path === "/style.css") return new Response("body{}", { headers: { "Content-Type": "text/css; charset=utf-8" } });
    switch (path) {
      case "/login":
      case "/register":
        return Response.redirect(new URL("/", request.url).href, 302);
      case "/estrenos":
        return html(ESTRENOS_HTML);
      case "/noticiero":
        return html(NOTICIERO_HTML);
      case "/perfil":
      case "/admin":
      case "/":
      case "/index":
      case "/dashboard":
        return html(INDEX_HTML);
      default:
        return html(NOT_FOUND_HTML, 404);
    }
  }
};

export { extractYouTubeId, pickYouTubeTrailer };
