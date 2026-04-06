// ELFILME.COM — Cloudflare Worker
// Rutas: /login /estrenos /noticiero /live / + APIs D1

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;

    if (path.startsWith('/api/')) return handleAPI(path, method, request, env);
    if (path === '/style.css') return new Response('body{}', { headers: { 'Content-Type': 'text/css' } });

    switch (path) {
      case '/login':
      case '/register':  return html(LOGIN_HTML);
      case '/estrenos':  return html(ESTRENOS_HTML);
      case '/noticiero': return html(NOTICIERO_HTML);
      case '/live':      return html(LIVE_HTML);
      case '/':
      case '/index':
      case '/dashboard': return checkAuth(request, env);
      default:           return html(NOT_FOUND_HTML, 404);
    }
  }
};

async function checkAuth(request, env) {
  const token = (request.headers.get('Cookie') || '').match(/elfilme_token=([^;]+)/)?.[1];
  if (!token) return Response.redirect(new URL('/login', request.url).href, 302);
  try {
    const s = await env.DB.prepare('SELECT u.username FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires_at>datetime("now")').bind(token).first();
    if (!s) return Response.redirect(new URL('/login', request.url).href, 302);
    return html(INDEX_HTML);
  } catch { return Response.redirect(new URL('/login', request.url).href, 302); }
}

async function getAuthUser(request, env) {
  const token = (request.headers.get('Cookie') || '').match(/elfilme_token=([^;]+)/)?.[1];
  if (!token) return null;
  try { return await env.DB.prepare('SELECT u.id, u.username, u.email, u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires_at>datetime("now")').bind(token).first(); }
  catch { return null; }
}

function html(body, status = 200) { return new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }); }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }

async function handleAPI(path, method, request, env) {

  // LOGIN
  if (path === '/api/login' && method === 'POST') {
    try {
      const { user, password } = await request.json();
      if (!user || !password) return json({ error: 'Completa todos los campos' }, 400);
      const found = await env.DB.prepare('SELECT * FROM users WHERE (LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)) AND is_active=1').bind(user, user).first();
      if (!found || found.password_hash !== btoa(password)) return json({ error: 'Usuario o contrasena incorrectos' }, 401);
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 7*24*60*60*1000).toISOString();
      await env.DB.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').bind(found.id, token, expires).run();
      await env.DB.prepare('UPDATE users SET last_login=datetime("now") WHERE id=?').bind(found.id).run();
      return new Response(JSON.stringify({ ok: true, username: found.username }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'elfilme_token=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800' } });
    } catch { return json({ error: 'Error del servidor' }, 500); }
  }

  // REGISTER
  if (path === '/api/register' && method === 'POST') {
    try {
      const { username, email, password } = await request.json();
      if (!username || !email || !password) return json({ error: 'Completa todos los campos' }, 400);
      if (password.length < 6) return json({ error: 'Contrasena minimo 6 caracteres' }, 400);
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return json({ error: 'Usuario: letras, numeros y _ (3-20 chars)' }, 400);
      const exists = await env.DB.prepare('SELECT id FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)').bind(username, email).first();
      if (exists) return json({ error: 'Usuario o correo ya registrado' }, 409);
      await env.DB.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, "member")').bind(username, email.toLowerCase(), btoa(password)).run();
      return json({ ok: true });
    } catch { return json({ error: 'Error al registrar' }, 500); }
  }

  // LOGOUT
  if (path === '/api/logout' && method === 'POST') {
    const token = (request.headers.get('Cookie') || '').match(/elfilme_token=([^;]+)/)?.[1];
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'elfilme_token=; Path=/; Max-Age=0' } });
  }

  // WATCHLIST GET
  if (path === '/api/watchlist' && method === 'GET') {
    const user = await getAuthUser(request, env);
    if (!user) return json({ error: 'No autorizado' }, 401);
    const items = await env.DB.prepare('SELECT * FROM watchlist WHERE user_id=? ORDER BY added_at DESC').bind(user.id).all();
    return json({ ok: true, items: items.results });
  }

  // WATCHLIST ADD
  if (path === '/api/watchlist' && method === 'POST') {
    const user = await getAuthUser(request, env);
    if (!user) return json({ error: 'No autorizado' }, 401);
    const { tmdb_id, title, poster_path } = await request.json();
    if (!tmdb_id || !title) return json({ error: 'Datos incompletos' }, 400);
    try {
      await env.DB.prepare('INSERT INTO watchlist (user_id, tmdb_id, title, poster_path) VALUES (?, ?, ?, ?)').bind(user.id, tmdb_id, title, poster_path || '').run();
      return json({ ok: true });
    } catch { return json({ error: 'Ya esta en tu lista' }, 409); }
  }

  // WATCHLIST DELETE
  if (path.startsWith('/api/watchlist/') && method === 'DELETE') {
    const user = await getAuthUser(request, env);
    if (!user) return json({ error: 'No autorizado' }, 401);
    const tmdb_id = path.split('/').pop();
    await env.DB.prepare('DELETE FROM watchlist WHERE user_id=? AND tmdb_id=?').bind(user.id, tmdb_id).run();
    return json({ ok: true });
  }

  // COMMENTS GET
  if (path.startsWith('/api/comments/') && method === 'GET') {
    const tmdb_id = path.split('/').pop();
    const comments = await env.DB.prepare('SELECT c.id, c.body, c.rating, c.created_at, u.username FROM comments c JOIN users u ON c.user_id=u.id WHERE c.tmdb_id=? AND c.is_active=1 ORDER BY c.created_at DESC LIMIT 50').bind(tmdb_id).all();
    return json({ ok: true, comments: comments.results });
  }

  // COMMENTS ADD
  if (path === '/api/comments' && method === 'POST') {
    const user = await getAuthUser(request, env);
    if (!user) return json({ error: 'No autorizado' }, 401);
    const { tmdb_id, movie_title, body, rating } = await request.json();
    if (!tmdb_id || !body || body.trim().length < 3) return json({ error: 'Comentario muy corto' }, 400);
    await env.DB.prepare('INSERT INTO comments (user_id, tmdb_id, movie_title, body, rating) VALUES (?, ?, ?, ?, ?)').bind(user.id, tmdb_id, movie_title || '', body.trim(), rating || null).run();
    return json({ ok: true });
  }

  // MESSAGES GET
  if (path === '/api/messages' && method === 'GET') {
    const user = await getAuthUser(request, env);
    if (!user) return json({ error: 'No autorizado' }, 401);
    const msgs = await env.DB.prepare('SELECT m.id, m.body, m.is_read, m.created_at, m.from_user_id, m.to_user_id, uf.username as from_username, ut.username as to_username FROM messages m JOIN users uf ON m.from_user_id=uf.id JOIN users ut ON m.to_user_id=ut.id WHERE m.to_user_id=? OR m.from_user_id=? ORDER BY m.created_at DESC LIMIT 50').bind(user.id, user.id).all();
    await env.DB.prepare('UPDATE messages SET is_read=1 WHERE to_user_id=? AND is_read=0').bind(user.id).run();
    return json({ ok: true, messages: msgs.results });
  }

  // MESSAGES SEND
  if (path === '/api/messages' && method === 'POST') {
    const user = await getAuthUser(request, env);
    if (!user) return json({ error: 'No autorizado' }, 401);
    const { to_username, body } = await request.json();
    if (!to_username || !body) return json({ error: 'Datos incompletos' }, 400);
    const recipient = await env.DB.prepare('SELECT id FROM users WHERE LOWER(username)=LOWER(?)').bind(to_username).first();
    if (!recipient) return json({ error: 'Usuario no encontrado' }, 404);
    if (recipient.id === user.id) return json({ error: 'No puedes escribirte a ti mismo' }, 400);
    await env.DB.prepare('INSERT INTO messages (from_user_id, to_user_id, body) VALUES (?, ?, ?)').bind(user.id, recipient.id, body.trim()).run();
    return json({ ok: true });
  }

  // MESSAGES UNREAD COUNT
  if (path === '/api/messages/unread' && method === 'GET') {
    const user = await getAuthUser(request, env);
    if (!user) return json({ error: 'No autorizado' }, 401);
    const result = await env.DB.prepare('SELECT COUNT(*) as count FROM messages WHERE to_user_id=? AND is_read=0').bind(user.id).first();
    return json({ ok: true, count: result.count });
  }

  return json({ error: 'Not found' }, 404);
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ElFilme — Acceso VIP</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
  <style>
    :root{--bg:#080808;--red:#e50914;--red-dark:#b0060f;--red-glow:rgba(229,9,20,0.3);--white:#fff;--gray:#888;--input-bg:rgba(255,255,255,0.06);--border:rgba(255,255,255,0.1);}
    *{margin:0;padding:0;box-sizing:border-box;}
    html,body{height:100%;}
    body{background:var(--bg);color:var(--white);font-family:"DM Sans",sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;}
    .collage{position:fixed;inset:0;display:grid;grid-template-columns:repeat(6,1fr);grid-template-rows:repeat(4,1fr);gap:3px;z-index:0;transform:scale(1.05);}
    .collage-cell{overflow:hidden;}
    .collage-cell img{width:100%;height:100%;object-fit:cover;display:block;filter:saturate(0.6) brightness(0.45);animation:slowzoom 20s ease-in-out infinite alternate;}
    .collage-cell:nth-child(odd) img{animation-delay:-10s;}
    .collage-cell:nth-child(3n) img{animation-delay:-5s;}
    @keyframes slowzoom{from{transform:scale(1);}to{transform:scale(1.08);}}
    .collage-overlay{position:fixed;inset:0;background:radial-gradient(ellipse 65% 85% at 50% 50%,rgba(8,8,8,0.5) 0%,rgba(8,8,8,0.93) 100%);z-index:1;}
    .red-pulse{position:fixed;inset:0;background:radial-gradient(ellipse 50% 50% at 50% 50%,rgba(229,9,20,0.07) 0%,transparent 70%);z-index:2;animation:redpulse 4s ease-in-out infinite;}
    @keyframes redpulse{0%,100%{opacity:0.6;}50%{opacity:1;}}
    .container{position:relative;z-index:10;width:100%;max-width:400px;padding:16px;animation:fadeUp 0.7s cubic-bezier(.16,1,.3,1) both;}
    @keyframes fadeUp{from{opacity:0;transform:translateY(32px);}to{opacity:1;transform:translateY(0);}}
    .logo-wrap{text-align:center;margin-bottom:28px;}
    .logo-img{height:64px;width:auto;object-fit:contain;border-radius:8px;filter:drop-shadow(0 0 20px rgba(229,9,20,0.4));}
    .vip-label{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:10px;}
    .vip-word{font-family:"Bebas Neue",cursive;font-size:32px;letter-spacing:10px;background:linear-gradient(135deg,#c8a84b 0%,#f5e27a 35%,#d4af37 55%,#f0d060 75%,#b8962e 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 2px 8px rgba(212,175,55,0.5));animation:goldshine 3s ease-in-out infinite;}
    @keyframes goldshine{0%,100%{filter:drop-shadow(0 2px 6px rgba(212,175,55,0.4));}50%{filter:drop-shadow(0 2px 20px rgba(245,226,122,0.9));}}
    .vip-access{font-size:9px;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,0.25);font-weight:500;}
    .vip-exclusive{font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:.5px;font-weight:300;margin-top:2px;}
    .card{background:rgba(10,10,10,0.88);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:32px 28px;box-shadow:0 0 0 1px rgba(229,9,20,0.06),0 32px 64px rgba(0,0,0,0.8),0 0 40px rgba(229,9,20,0.08);}
    .tabs{display:flex;margin-bottom:24px;border-bottom:1px solid rgba(255,255,255,0.08);}
    .tab{flex:1;padding:9px 8px;text-align:center;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--gray);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .2s;}
    .tab.active{color:var(--white);border-bottom-color:var(--red);}
    .tab:hover:not(.active){color:#bbb;}
    .form{display:none;flex-direction:column;gap:14px;}
    .form.active{display:flex;}
    label{font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--gray);display:block;margin-bottom:5px;}
    input{width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:5px;padding:11px 14px;color:var(--white);font-family:"DM Sans",sans-serif;font-size:14px;outline:none;transition:all .2s;}
    input:focus{border-color:rgba(229,9,20,0.6);background:rgba(255,255,255,0.08);box-shadow:0 0 0 3px rgba(229,9,20,0.1);}
    input::placeholder{color:rgba(255,255,255,0.2);}
    .btn{background:var(--red);color:#fff;border:none;border-radius:5px;padding:13px;font-family:system-ui,-apple-system,sans-serif;font-size:15px;font-weight:700;letter-spacing:.5px;cursor:pointer;transition:all .2s;margin-top:4px;width:100%;}
    .btn:hover{background:var(--red-dark);box-shadow:0 6px 24px var(--red-glow);}
    .btn:active{transform:scale(0.98);}
    .btn:disabled{opacity:.5;cursor:not-allowed;transform:none;}
    .btn .spinner{display:none;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto;}
    .btn.loading .btn-text{display:none;}
    .btn.loading .spinner{display:block;}
    @keyframes spin{to{transform:rotate(360deg);}}
    .msg{display:none;padding:9px 13px;border-radius:5px;font-size:12.5px;font-weight:500;text-align:center;}
    .msg.error{display:block;background:rgba(229,9,20,.1);border:1px solid rgba(229,9,20,.25);color:#ff7b7b;}
    .msg.success{display:block;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);color:#6ee8b4;}
    .footer-text{text-align:center;font-size:10px;color:rgba(255,255,255,.12);margin-top:24px;letter-spacing:2px;text-transform:uppercase;}
    @media(max-width:440px){.card{padding:24px 18px;}.logo-img{height:52px;}}
  </style>
<script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js"></script>
</head>
<body>

<div class="collage" id="collage"></div>
<div class="collage-overlay"></div>
<div class="red-pulse"></div>

<div class="container">
  <div class="logo-wrap">
    <img src="https://elfilme.com/copilot_image_1772812453252.jpeg" alt="ElFilme" class="logo-img"/>
    <div class="vip-label">
      <span class="vip-word">VIP</span>
      <span class="vip-access">Acceso &middot; Registro Abierto</span>
      <span class="vip-exclusive">Contenido exclusivo para miembros premium</span>
    </div>
  </div>

  <div class="card">
    <div class="tabs">
      <div class="tab active" onclick="switchTab('login')">Iniciar Sesi&oacute;n</div>
      <div class="tab" onclick="switchTab('register')">Registrarse</div>
    </div>

    <div class="form active" id="form-login">
      <div id="msg-login" class="msg"></div>
      <div>
        <label>Usuario o Correo</label>
        <input type="text" id="login-user" placeholder="usuario o correo@email.com" autocomplete="username"/>
      </div>
      <div>
        <label>Contrase&ntilde;a</label>
        <input type="password" id="login-pass" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="current-password"/>
      </div>
      <button class="btn" onclick="doLogin()">
        <span class="btn-text">ENTRAR</span>
        <div class="spinner"></div>
      </button>
    </div>

    <div class="form" id="form-register">
      <div id="msg-register" class="msg"></div>
      <div>
        <label>Usuario</label>
        <input type="text" id="reg-user" placeholder="cinefilo_123" autocomplete="username"/>
      </div>
      <div>
        <label>Correo</label>
        <input type="email" id="reg-email" placeholder="correo@email.com" autocomplete="email"/>
      </div>
      <div>
        <label>Contrase&ntilde;a</label>
        <input type="password" id="reg-pass" placeholder="M&iacute;nimo 6 caracteres" autocomplete="new-password"/>
      </div>
      <button class="btn" onclick="doRegister()">
        <span class="btn-text">CREAR CUENTA</span>
        <div class="spinner"></div>
      </button>
    </div>
  </div>

  <div class="footer-text">elfilme.com</div>
</div>

<script>
// Auth via API D1

const REDIRECT  = '/';



const POSTERS = [
  'https://image.tmdb.org/t/p/w342/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg',
  'https://image.tmdb.org/t/p/w342/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg',
  'https://image.tmdb.org/t/p/w342/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg',
  'https://image.tmdb.org/t/p/w342/5VTN0pR8gcqV3EPUHHfMGnJYspL.jpg',
  'https://image.tmdb.org/t/p/w342/xudoOPFa1H0RCMhMvEqW3OlLjJa.jpg',
  'https://image.tmdb.org/t/p/w342/gEjNlhZhyHeto6a6jnxgCYLiuBB.jpg',
  'https://image.tmdb.org/t/p/w342/uxzzxijgPIY7slzFvMotPv8wjKA.jpg',
  'https://image.tmdb.org/t/p/w342/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
  'https://image.tmdb.org/t/p/w342/iNh3BivHyg5sQRPP1KOkzguEX0H.jpg',
  'https://image.tmdb.org/t/p/w342/hek3koDUyRQk7FIhPXsa6mT2Zc3.jpg',
  'https://image.tmdb.org/t/p/w342/3bhkrj58Vtu7enYsLegHnDmni2k.jpg',
  'https://image.tmdb.org/t/p/w342/y7T6cl5PlQXlAqs4xrfIdVAzCGE.jpg',
  'https://image.tmdb.org/t/p/w342/6FfCtAuVAW8XJjZ7eWeLibRLWTw.jpg',
  'https://image.tmdb.org/t/p/w342/mDfJG3LC3Dqb67AZ52x3Z0jU0uB.jpg',
  'https://image.tmdb.org/t/p/w342/9Gtg2DzBhmYamXBS1hKAhiwbBKS.jpg',
  'https://image.tmdb.org/t/p/w342/rCzpDGLbOoPwLjy3OAm5NUPOTrC.jpg',
  'https://image.tmdb.org/t/p/w342/A7AoNT06aRAc4SV89Dwplto2pIo.jpg',
  'https://image.tmdb.org/t/p/w342/pWe3qGTX8uTJv7jOUwMQCAAMJfI.jpg',
  'https://image.tmdb.org/t/p/w342/qdIMHd4sEfJSckfVJfKQvisL02a.jpg',
  'https://image.tmdb.org/t/p/w342/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
  'https://image.tmdb.org/t/p/w342/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
  'https://image.tmdb.org/t/p/w342/gsCFqAnONkJjEzNqJDHpmRqMnlC.jpg',
  'https://image.tmdb.org/t/p/w342/8I37NtDffNV7AZlDa7uDvvqhovU.jpg',
  'https://image.tmdb.org/t/p/w342/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg'
];

(function buildCollage(){
  const grid = document.getElementById('collage');
  const shuffled = [...POSTERS].sort(()=>Math.random()-.5);
  for(let i=0;i<24;i++){
    const cell=document.createElement('div');
    cell.className='collage-cell';
    const img=document.createElement('img');
    img.src=shuffled[i%shuffled.length];
    img.alt='';
    img.loading='lazy';
    cell.appendChild(img);
    grid.appendChild(cell);
  }
})();

function switchTab(tab){
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',(tab==='login'&&i===0)||(tab==='register'&&i===1)));
  document.querySelectorAll('.form').forEach(f=>f.classList.remove('active'));
  document.getElementById('form-'+tab).classList.add('active');
}

function showMsg(id,text,type){const el=document.getElementById(id);el.textContent=text;el.className='msg '+type;}
function setLoading(btn,on){btn.disabled=on;btn.classList.toggle('loading',on);}

async function doLogin(){
  const user=document.getElementById('login-user').value.trim();
  const pass=document.getElementById('login-pass').value;
  const btn=document.querySelector('#form-login .btn');
  if(!user||!pass)return showMsg('msg-login','Completa todos los campos.','error');
  setLoading(btn,true);showMsg('msg-login','','');
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user,password:pass})});
    const d=await r.json();
    if(d.ok){
      showMsg('msg-login','Bienvenido '+d.username+'!','success');
      localStorage.setItem('elfilme_user',JSON.stringify({username:d.username,loginDate:new Date().toISOString()}));
      setTimeout(()=>window.location.href=REDIRECT,900);
    } else showMsg('msg-login',d.error||'Error de acceso','error');
  }catch(e){showMsg('msg-login','Error de conexion','error');}
  setLoading(btn,false);
}

async function doRegister(){
  const username=document.getElementById('reg-user').value.trim();
  const email=document.getElementById('reg-email').value.trim().toLowerCase();
  const password=document.getElementById('reg-pass').value;
  const btn=document.querySelector('#form-register .btn');
  if(!username||!email||!password)return showMsg('msg-register','Completa todos los campos.','error');
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return showMsg('msg-register','El correo no es valido.','error');
  if(password.length<6)return showMsg('msg-register','La contrasena debe tener al menos 6 caracteres.','error');
  if(!/^[a-zA-Z0-9_]{3,20}$/.test(username))return showMsg('msg-register','Usuario: solo letras, numeros y _ (3-20 caracteres).','error');
  setLoading(btn,true);showMsg('msg-register','','');
  try{
    const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,email,password})});
    const d=await r.json();
    if(d.ok){
      showMsg('msg-register','Cuenta creada! Iniciando sesion...','success');
      setTimeout(()=>{switchTab('login');document.getElementById('login-user').value=username;['reg-user','reg-email','reg-pass'].forEach(id=>document.getElementById(id).value='');},1500);
    } else showMsg('msg-register',d.error||'Error al registrar','error');
  }catch(e){showMsg('msg-register','Error de conexion','error');}
  setLoading(btn,false);
}

emailjs.init("PffiWoLRSY9YKO3-B");

document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  if(document.getElementById('form-login').classList.contains('active'))doLogin();
  else doRegister();
});
</script>
</body>
</html>
`;
const INDEX_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>ElFilme — Tu Cine VIP</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,400&family=Bebas+Neue&display=swap" rel="stylesheet"/>
<style>
:root {
  --bg:#0a0a0a;--bg2:#111;--bg3:#1a1a1a;
  --glass:rgba(255,255,255,0.04);--glass2:rgba(255,255,255,0.07);
  --border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.12);
  --text:#e5e5e5;--muted:#888;--muted2:#555;
  --accent:#e50914;--accent2:#b20710;--accent3:#ff3d47;
  --white:#fff;--danger:#f87171;--success:#34d399;
  --radius:6px;--blur:blur(16px);
}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif;min-height:100vh;overflow-x:hidden;}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 70% 50% at 15% 5%,rgba(229,9,20,0.1) 0%,transparent 55%),radial-gradient(ellipse 50% 40% at 85% 85%,rgba(229,9,20,0.05) 0%,transparent 50%);pointer-events:none;z-index:0;}
body>*{position:relative;z-index:1;}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:rgba(229,9,20,0.3);border-radius:4px;}
@keyframes shimmer{0%{background-position:-800px 0}100%{background-position:800px 0}}
.skeleton{background:linear-gradient(90deg,var(--bg3) 25%,#2a2a2a 50%,var(--bg3) 75%);background-size:800px 100%;animation:shimmer 1.4s infinite linear;border-radius:var(--radius);}
.skeleton-card{aspect-ratio:2/3;border-radius:var(--radius);}
@keyframes goldshine{0%,100%{filter:drop-shadow(0 0 6px rgba(212,175,55,0.4))}50%{filter:drop-shadow(0 0 14px rgba(245,226,122,0.8))}}
.gold-text{background:linear-gradient(135deg,#d4af37,#f5e27a,#b8962e,#f0d060);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:goldshine 2.5s infinite;}
.page{display:none;opacity:0;transform:translateY(12px);transition:opacity .35s ease,transform .35s ease;}
.page.active{display:block;opacity:1;transform:translateY(0);}

/* ── HEADER MOBILE FIRST ── */
header{
  position:sticky;top:0;z-index:200;
  background:rgba(10,10,10,0.97);
  backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
  border-bottom:1px solid var(--border);
  padding:0 1rem;height:58px;
  display:flex;align-items:center;justify-content:space-between;gap:.8rem;
}
.logo{cursor:pointer;display:flex;align-items:center;gap:.6rem;flex-shrink:0;}
.logo img{height:40px;width:auto;object-fit:contain;border-radius:6px;}

/* Mobile search toggle */
.search-icon-btn{background:none;border:none;color:var(--muted);font-size:1.1rem;cursor:pointer;padding:6px;display:flex;align-items:center;transition:color .2s;}
.search-icon-btn:hover{color:var(--white);}

/* Hamburger */
.hamburger{background:none;border:none;cursor:pointer;display:flex;flex-direction:column;gap:5px;padding:6px;flex-shrink:0;}
.hamburger span{display:block;width:22px;height:2px;background:var(--white);border-radius:2px;transition:all .3s;}
.hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg);}
.hamburger.open span:nth-child(2){opacity:0;}
.hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg);}

/* Header search bar (mobile: hidden by default) */
.header-search-bar{
  position:absolute;top:58px;left:0;right:0;
  background:rgba(10,10,10,0.98);
  border-bottom:1px solid var(--border);
  padding:.7rem 1rem;
  display:none;z-index:199;
}
.header-search-bar.open{display:block;}
.header-search-bar input{
  width:100%;background:var(--glass2);border:1px solid var(--border2);
  border-radius:4px;padding:10px 16px 10px 38px;
  font-family:'Outfit',sans-serif;font-size:.9rem;color:var(--text);outline:none;
}
.header-search-bar input:focus{border-color:rgba(229,9,20,0.5);}
.header-search-bar input::placeholder{color:var(--muted2);}
.search-bar-icon{position:absolute;left:1.9rem;top:50%;transform:translateY(-50%);color:var(--muted2);font-size:.9rem;pointer-events:none;}

/* Desktop search (hidden mobile, shown desktop) */
.header-search-desktop{flex:1;max-width:360px;position:relative;display:none;}
.header-search-desktop input{width:100%;background:var(--glass);backdrop-filter:var(--blur);border:1px solid var(--border);border-radius:4px;padding:9px 16px 9px 38px;font-family:'Outfit',sans-serif;font-size:.85rem;color:var(--text);outline:none;transition:all .2s;}
.header-search-desktop input:focus{border-color:rgba(229,9,20,0.5);background:var(--glass2);}
.header-search-desktop input::placeholder{color:var(--muted2);}
.header-search-desktop .si{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--muted2);font-size:.85rem;}

.header-right-actions{display:flex;align-items:center;gap:.4rem;}
.fav-btn{background:var(--glass);border:1px solid var(--border);color:var(--muted);font-size:.78rem;padding:6px 10px;border-radius:4px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:4px;white-space:nowrap;}
.fav-btn:hover{color:var(--white);background:var(--glass2);}
.fav-count{background:var(--accent);color:#fff;font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:10px;}
.admin-btn{background:var(--accent);color:#fff;font-weight:600;padding:7px 12px;border-radius:4px;border:none;font-family:'Outfit',sans-serif;font-size:.78rem;cursor:pointer;transition:all .2s;}
.admin-btn:hover{background:var(--accent2);}

/* Hidden on mobile by default */
.desktop-nav{display:none;}
.desktop-user{display:none;}

/* ── SLIDE-IN MENU ── */
.side-menu{
  position:fixed;top:0;right:0;bottom:0;width:270px;
  background:#0e0e0e;
  border-left:1px solid var(--border);z-index:400;
  transform:translateX(100%);transition:transform .3s cubic-bezier(.25,.46,.45,.94);
  display:flex;flex-direction:column;padding:0;overflow-y:auto;
}
.side-menu.open{transform:translateX(0);}
.menu-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:399;display:none;}
.menu-overlay.open{display:block;}

.menu-user{padding:1.4rem 1.5rem 1.2rem;border-bottom:1px solid var(--border);margin-bottom:.3rem;margin-top:env(safe-area-inset-top,0);}
.menu-user-name{font-size:1rem;font-weight:600;color:var(--white);}
.menu-user-name strong{color:var(--accent);}
.menu-user-sub{font-size:.7rem;color:var(--muted);margin-top:3px;}

.menu-item{display:flex;align-items:center;gap:.85rem;padding:.8rem 1.5rem;color:var(--muted);font-size:.88rem;cursor:pointer;transition:all .2s;border-left:3px solid transparent;}
.menu-item:hover{color:var(--white);background:rgba(255,255,255,0.04);border-left-color:var(--accent);}
.menu-item-icon{flex-shrink:0;display:flex;align-items:center;}
.menu-item-badge{background:var(--accent);color:#fff;font-size:.58rem;font-weight:700;padding:2px 6px;border-radius:8px;margin-left:auto;}
.menu-item-new{background:linear-gradient(135deg,#d4af37,#f5e27a);color:#000;font-size:.55rem;font-weight:800;padding:2px 6px;border-radius:8px;margin-left:auto;letter-spacing:.05em;}

.menu-divider{height:1px;background:var(--border);margin:.5rem 1.5rem;}

.menu-section-label{padding:.4rem 1.5rem .2rem;font-size:.62rem;color:var(--muted2);letter-spacing:.15em;font-weight:600;text-transform:uppercase;}

.menu-bottom{margin-top:auto;padding:.8rem 0;border-top:1px solid var(--border);}
.logout-menu-btn{display:flex;align-items:center;gap:.85rem;padding:.8rem 1.5rem;color:rgba(229,9,20,0.6);font-size:.88rem;cursor:pointer;transition:all .2s;width:100%;background:none;border:none;font-family:'Outfit',sans-serif;}
.logout-menu-btn:hover{color:var(--accent);}

/* ── VIP BANNER (simplified) ── */
.vip-banner{
  background:linear-gradient(90deg,#0a0a0a 0%,rgba(229,9,20,0.07) 50%,#0a0a0a 100%);
  border-bottom:1px solid rgba(229,9,20,0.12);
  padding:.55rem 1.2rem;
  display:flex;align-items:center;justify-content:center;gap:.7rem;
}
.vip-banner-text{font-family:'Bebas Neue',cursive;font-size:1rem;letter-spacing:.12em;color:rgba(255,255,255,0.5);}
.vip-banner-name{color:var(--accent);}

/* ── ESTRENOS PREMIUM BANNER ── */
@keyframes pulseGlow{0%,100%{box-shadow:0 0 0 0 rgba(229,9,20,0);}50%{box-shadow:0 0 24px 4px rgba(229,9,20,0.25);}}
@keyframes tickerMove{0%{transform:translateX(100vw);}100%{transform:translateX(-100%)}}
@keyframes badgePulse{0%,100%{opacity:1;}50%{opacity:.6;}}

.estrenos-banner{
  position:relative;overflow:hidden;cursor:pointer;
  background:linear-gradient(135deg,#0d0d0d 0%,#1a0000 40%,#0d0d0d 100%);
  border-bottom:1px solid rgba(229,9,20,0.2);
  min-height:160px;display:flex;align-items:stretch;
  transition:filter .3s;
}
.estrenos-banner:hover{filter:brightness(1.05);}
.estrenos-banner-bg{
  position:absolute;inset:0;
  background-size:cover;background-position:center;
  opacity:.18;transition:opacity .5s,background-image .5s;
}
.estrenos-banner-overlay{
  position:absolute;inset:0;
  background:linear-gradient(90deg,rgba(10,10,10,.96) 45%,rgba(10,10,10,.6) 75%,transparent 100%),
             linear-gradient(to top,rgba(10,10,10,.8) 0%,transparent 60%);
}
.estrenos-banner-content{
  position:relative;z-index:2;
  display:flex;align-items:center;gap:1.2rem;
  padding:1.1rem 1.2rem;width:100%;
}
.estrenos-poster-thumb{
  width:72px;min-width:72px;aspect-ratio:2/3;border-radius:6px;overflow:hidden;
  border:1px solid rgba(255,255,255,0.12);
  box-shadow:0 8px 24px rgba(0,0,0,.8);flex-shrink:0;
  background:var(--bg3);
}
.estrenos-poster-thumb img{width:100%;height:100%;object-fit:cover;}
.estrenos-text{flex:1;min-width:0;}
.estrenos-badge-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;flex-wrap:wrap;}
.now-playing-badge{
  display:inline-flex;align-items:center;gap:.3rem;
  background:var(--accent);color:#fff;
  font-family:'Bebas Neue',cursive;font-size:.72rem;letter-spacing:.12em;
  padding:3px 10px;border-radius:3px;
  animation:badgePulse 2s infinite;
  flex-shrink:0;
}
.now-playing-badge::before{content:'●';font-size:.5rem;line-height:1;}
.estrenos-label-badge{
  display:inline-flex;align-items:center;
  background:rgba(212,175,55,0.15);border:1px solid rgba(212,175,55,0.35);
  color:#d4af37;font-size:.62rem;font-weight:700;letter-spacing:.08em;
  padding:2px 8px;border-radius:3px;white-space:nowrap;
}
.estrenos-title{font-family:'Bebas Neue',cursive;font-size:1.5rem;letter-spacing:.04em;color:var(--white);line-height:1;margin-bottom:.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.estrenos-subtitle{font-size:.75rem;color:rgba(255,255,255,0.5);margin-bottom:.5rem;}
.estrenos-cta{
  display:inline-flex;align-items:center;gap:.4rem;
  background:var(--accent);color:#fff;
  font-family:'Outfit',sans-serif;font-size:.72rem;font-weight:600;
  padding:7px 12px;border-radius:3px;border:none;cursor:pointer;
  text-decoration:none;white-space:nowrap;
  box-shadow:0 4px 12px rgba(229,9,20,0.4);
  transition:all .2s;align-self:flex-start;
}
.estrenos-cta:hover{background:var(--accent2);transform:translateY(-1px);}
.estrenos-right{flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:.5rem;padding-right:.2rem;}
.estrenos-count-badge{
  background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);
  border-radius:4px;padding:.3rem .6rem;text-align:center;
}
.estrenos-count-num{font-family:'Bebas Neue',cursive;font-size:1.4rem;color:var(--accent);line-height:1;}
.estrenos-count-label{font-size:.58rem;color:var(--muted);letter-spacing:.08em;display:block;}

/* Ticker */
.estrenos-ticker{
  position:absolute;bottom:0;left:0;right:0;
  background:rgba(229,9,20,0.12);border-top:1px solid rgba(229,9,20,0.2);
  padding:3px 0;overflow:hidden;height:20px;display:flex;align-items:center;
}
.estrenos-ticker-inner{
  white-space:nowrap;font-size:.6rem;color:rgba(255,255,255,0.4);letter-spacing:.1em;
  animation:tickerMove 18s linear infinite;
}

/* ── MAIN HERO ── */
.hero{position:relative;height:56vw;min-height:240px;max-height:480px;overflow:hidden;display:flex;align-items:flex-end;}
.hero-bg{position:absolute;inset:0;}
.hero-bg img{width:100%;height:100%;object-fit:cover;opacity:.3;}
.hero-overlay{position:absolute;inset:0;background:linear-gradient(to right,rgba(10,10,10,.97) 35%,transparent),linear-gradient(to top,rgba(10,10,10,1) 0%,transparent 45%);}
.hero-content{position:relative;padding:1.5rem 1.2rem;max-width:100%;}
.hero-badge{display:inline-flex;align-items:center;gap:.4rem;background:rgba(229,9,20,0.15);border:1px solid rgba(229,9,20,0.3);color:var(--accent);font-size:.68rem;font-weight:600;padding:3px 10px;border-radius:4px;margin-bottom:.6rem;letter-spacing:.05em;}
.hero-title{font-family:'Playfair Display',serif;font-size:clamp(1.4rem,5vw,2.5rem);line-height:1.1;color:var(--white);margin-bottom:.5rem;}
.hero-meta{display:flex;gap:.6rem;align-items:center;font-size:.78rem;color:var(--muted);margin-bottom:.8rem;flex-wrap:wrap;}
.hero-meta .rating{color:var(--accent);font-weight:600;}
.hero-btns{display:flex;gap:.6rem;flex-wrap:wrap;}
.btn-watch{background:var(--accent);color:#fff;font-weight:600;padding:9px 20px;border-radius:4px;border:none;font-family:'Outfit',sans-serif;font-size:.84rem;cursor:pointer;transition:all .25s;display:flex;align-items:center;gap:.4rem;box-shadow:0 6px 20px rgba(229,9,20,0.35);}
.btn-watch:hover{background:var(--accent2);transform:translateY(-2px);}
.btn-info{background:var(--glass);backdrop-filter:var(--blur);color:var(--white);font-weight:500;padding:9px 20px;border-radius:4px;border:1px solid var(--border2);font-family:'Outfit',sans-serif;font-size:.84rem;cursor:pointer;transition:all .2s;}
.btn-info:hover{background:var(--glass2);}

/* ── GENRE BAR ── */
.genre-bar{display:flex;gap:.4rem;flex-wrap:nowrap;overflow-x:auto;padding:.8rem 1.2rem;scrollbar-width:none;}
.genre-bar::-webkit-scrollbar{display:none;}
.genre-pill{background:var(--glass);backdrop-filter:var(--blur);border:1px solid var(--border);color:var(--muted);font-family:'Outfit',sans-serif;font-size:.75rem;padding:5px 14px;border-radius:20px;cursor:pointer;transition:all .2s;white-space:nowrap;flex-shrink:0;}
.genre-pill:hover{background:var(--glass2);color:var(--text);}
.genre-pill.active{background:rgba(229,9,20,0.2);color:var(--accent);border-color:rgba(229,9,20,0.4);font-weight:600;}

/* ── ROW SECTIONS ── */
.row-section{padding:1rem 0 1rem 1.2rem;position:relative;}
.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.8rem;padding-right:1.2rem;}
.section-title{font-family:'Playfair Display',serif;font-size:1.1rem;color:var(--white);}
.section-title-line{font-family:'Bebas Neue',cursive;font-size:1.3rem;letter-spacing:2px;color:#fff;display:flex;align-items:center;gap:10px;}
.section-title-line::after{content:'';height:1px;background:var(--accent);flex:1;opacity:.35;}
.row-scroll{display:flex;gap:10px;overflow-x:auto;overflow-y:visible;scroll-behavior:smooth;padding:.5rem 1.2rem .8rem 0;scrollbar-width:none;-ms-overflow-style:none;}
.row-scroll::-webkit-scrollbar{display:none;}
.row-scroll .card{flex:0 0 130px;width:130px;}

/* ── CARDS ── */
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1rem;}
.card{position:relative;border-radius:var(--radius);overflow:hidden;cursor:pointer;background:var(--glass);border:1px solid var(--border);aspect-ratio:2/3;transition:transform .3s cubic-bezier(.25,.46,.45,.94),box-shadow .3s ease;}
.card:active{transform:scale(0.96);}
.card-poster{width:100%;height:100%;object-fit:cover;display:block;}
.card-poster-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2.5rem;background:linear-gradient(135deg,var(--bg3),var(--bg2));}
.card-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(10,10,10,1) 0%,rgba(10,10,10,0.7) 55%,transparent 100%);opacity:0;transition:opacity .25s;display:flex;flex-direction:column;justify-content:flex-end;padding:.8rem .7rem;}
.card:hover .card-overlay,.card:focus-within .card-overlay{opacity:1;}
.card-title-ov{font-size:.78rem;font-weight:600;color:var(--white);margin-bottom:.25rem;line-height:1.3;}
.card-meta-ov{font-size:.68rem;color:var(--muted);display:flex;gap:.4rem;align-items:center;}
.card-rating{color:var(--accent);font-weight:600;}
.card-actions{display:flex;gap:.3rem;margin-top:.4rem;}
.card-action-btn{background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:.62rem;padding:3px 7px;border-radius:3px;cursor:pointer;font-family:'Outfit',sans-serif;transition:background .15s;white-space:nowrap;}
.card-action-btn:hover{background:var(--accent);}
.card-action-btn.red{background:rgba(229,9,20,0.3);border-color:rgba(229,9,20,0.4);}
.card-fav{position:absolute;top:.5rem;right:.5rem;background:rgba(10,10,10,0.6);border:1px solid var(--border);border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:.78rem;transition:all .2s;opacity:0;}
.card:hover .card-fav{opacity:1;}
.card-fav.active{opacity:1;background:rgba(229,9,20,0.2);border-color:rgba(229,9,20,0.4);}
.card-type-badge{position:absolute;top:.5rem;left:.5rem;background:rgba(10,10,10,0.7);color:var(--accent);font-size:.58rem;font-weight:600;padding:2px 7px;border-radius:4px;letter-spacing:.04em;border:1px solid rgba(229,9,20,0.2);}
.card-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:42px;height:42px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .25s;font-size:.9rem;color:#fff;box-shadow:0 6px 20px rgba(229,9,20,0.5);}
.card:hover .card-play{opacity:1;}

/* ── DETAIL ── */
.detail-hero{position:relative;min-height:300px;display:flex;align-items:flex-end;overflow:hidden;}
.detail-hero-bg{position:absolute;inset:0;}
.detail-hero-bg img{width:100%;height:100%;object-fit:cover;opacity:.25;}
.detail-overlay{position:absolute;inset:0;background:linear-gradient(to top,var(--bg) 20%,rgba(10,10,10,0.6) 100%);}
.detail-content{position:relative;padding:1.5rem 1.2rem;display:flex;flex-direction:column;gap:1.2rem;width:100%;}
.detail-poster{width:100px;min-width:100px;aspect-ratio:2/3;border-radius:8px;overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,.7);}
.detail-poster img{width:100%;height:100%;object-fit:cover;}
.detail-poster-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2.5rem;background:var(--glass2);}
.detail-row{display:flex;gap:1.2rem;align-items:flex-end;}
.detail-info{flex:1;}
.detail-title{font-family:'Playfair Display',serif;font-size:clamp(1.4rem,4vw,2.2rem);color:var(--white);margin-bottom:.4rem;}
.detail-tagline{font-size:.85rem;color:var(--muted);font-style:italic;margin-bottom:.7rem;}
.detail-meta{display:flex;gap:.8rem;flex-wrap:wrap;font-size:.78rem;color:var(--muted);margin-bottom:.8rem;align-items:center;}
.detail-meta .rating{color:var(--accent);font-weight:700;font-size:.95rem;}
.genre-tags{display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:1rem;}
.genre-tag{background:var(--glass);border:1px solid var(--border);color:var(--muted);font-size:.68rem;padding:2px 10px;border-radius:4px;}
.detail-desc{font-size:.85rem;color:rgba(229,229,229,0.7);line-height:1.75;margin-bottom:1.2rem;}
.detail-btns{display:flex;gap:.6rem;flex-wrap:wrap;}
.player-section{padding:1rem 1.2rem;max-width:1200px;margin:0 auto;}
.player-wrap{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.8);}
.player-wrap iframe{width:100%;height:100%;border:none;}
.player-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:1rem;color:var(--muted);}
.likes-bar{display:flex;align-items:center;gap:1rem;margin-top:.8rem;padding:.7rem 0;border-top:1px solid var(--border);}
.like-btn{display:flex;align-items:center;gap:.5rem;background:var(--glass);border:1px solid var(--border);color:var(--muted);font-family:'Outfit',sans-serif;font-size:.88rem;padding:7px 18px;border-radius:50px;cursor:pointer;transition:all .25s;}
.like-btn:hover{background:var(--glass2);color:#fff;}
.like-btn.liked{background:rgba(229,9,20,0.15);border-color:rgba(229,9,20,0.5);color:var(--accent);}
.like-btn .like-heart{font-size:1rem;transition:transform .2s;}
.like-btn.liked .like-heart{transform:scale(1.2);}
.like-count{font-size:.82rem;color:var(--muted);}
.source-tabs{display:flex;gap:.4rem;margin-top:.8rem;flex-wrap:wrap;}
.source-tab{background:var(--glass);border:1px solid var(--border);color:var(--muted);font-family:'Outfit',sans-serif;font-size:.75rem;padding:6px 14px;border-radius:4px;cursor:pointer;transition:all .2s;}
.source-tab:hover{background:var(--glass2);color:var(--text);}
.source-tab.active{background:rgba(229,9,20,0.2);color:var(--accent);border-color:rgba(229,9,20,0.4);font-weight:600;}

/* ── EMPTY / SEARCH ── */
.empty-state{text-align:center;padding:4rem 1.5rem;color:var(--muted);}
.empty-icon{font-size:3rem;margin-bottom:1rem;}
.empty-title{font-family:'Playfair Display',serif;font-size:1.3rem;color:var(--text);margin-bottom:.5rem;}
.search-header{padding:1.5rem 1.2rem 1rem;border-bottom:1px solid var(--border);}
.search-query{font-family:'Playfair Display',serif;font-size:1.3rem;color:var(--white);}
.search-query span{color:var(--accent);}
.search-count{font-size:.82rem;color:var(--muted);margin-top:.3rem;}

/* ── MODALS ── */
.modal-overlay{position:fixed;inset:0;background:rgba(5,5,5,0.88);backdrop-filter:blur(8px);z-index:500;display:none;align-items:flex-start;justify-content:center;padding:1.5rem 1rem;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.modal-overlay.open{display:flex;}
.modal{background:rgba(15,15,15,0.97);backdrop-filter:var(--blur);border:1px solid var(--border2);border-radius:10px;width:100%;max-width:640px;margin:auto;box-shadow:0 40px 80px rgba(0,0,0,.9);max-height:90vh;overflow-y:auto;}
.modal-header{display:flex;align-items:center;justify-content:space-between;padding:1.2rem 1.4rem;border-bottom:1px solid var(--border);}
.modal-title{font-family:'Playfair Display',serif;font-size:1.1rem;color:var(--white);}
.modal-close{background:var(--glass);border:1px solid var(--border);color:var(--muted);font-size:1rem;cursor:pointer;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;}
.modal-body{padding:1.3rem;}
.modal-tabs{display:flex;gap:.2rem;margin-bottom:1.3rem;border-bottom:1px solid var(--border);}
.modal-tab{font-family:'Outfit',sans-serif;font-size:.8rem;padding:7px 14px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;}
.modal-tab.active{color:var(--accent);border-bottom-color:var(--accent);}
.modal-tab-content{display:none;}.modal-tab-content.active{display:block;}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;}
@media(max-width:480px){.form-grid{grid-template-columns:1fr;}}
.form-group{display:flex;flex-direction:column;gap:.3rem;}
.form-group.full{grid-column:1/-1;}
.form-label{font-size:.68rem;color:var(--muted);font-weight:500;letter-spacing:.04em;}
.form-input,.form-select,.form-textarea{background:var(--glass);border:1px solid var(--border);border-radius:6px;padding:9px 12px;font-family:'Outfit',sans-serif;font-size:.85rem;color:var(--text);outline:none;transition:all .2s;width:100%;}
.form-input:focus,.form-select:focus,.form-textarea:focus{border-color:rgba(229,9,20,0.5);background:var(--glass2);}
.form-select option{background:#111;}
.form-textarea{resize:vertical;min-height:80px;line-height:1.6;}
.form-footer{display:flex;justify-content:flex-end;gap:.7rem;margin-top:1.2rem;padding-top:1rem;border-top:1px solid var(--border);}
.btn-cancel{background:var(--glass);border:1px solid var(--border);color:var(--muted);font-family:'Outfit',sans-serif;font-size:.83rem;padding:8px 16px;border-radius:4px;cursor:pointer;}
.btn-save{background:var(--accent);color:#fff;font-family:'Outfit',sans-serif;font-size:.83rem;font-weight:600;padding:8px 20px;border-radius:4px;border:none;cursor:pointer;}
.admin-list{display:flex;flex-direction:column;gap:.5rem;max-height:380px;overflow-y:auto;}
.admin-item{display:flex;align-items:center;gap:.8rem;padding:.7rem .9rem;background:var(--glass);border-radius:8px;border:1px solid var(--border);}
.admin-item-poster{width:32px;height:46px;border-radius:4px;background:var(--glass2);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;}
.admin-item-info{flex:1;min-width:0;}
.admin-item-title{font-size:.84rem;font-weight:500;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.admin-item-meta{font-size:.68rem;color:var(--muted);margin-top:2px;}
.admin-item-actions{display:flex;gap:.3rem;flex-shrink:0;}
.btn-edit{background:rgba(229,9,20,0.08);border:1px solid rgba(229,9,20,0.2);color:var(--accent);font-size:.68rem;padding:3px 9px;border-radius:4px;cursor:pointer;font-family:'Outfit',sans-serif;}
.btn-del{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);color:var(--danger);font-size:.68rem;padding:3px 9px;border-radius:4px;cursor:pointer;font-family:'Outfit',sans-serif;}
.toast{position:fixed;bottom:1.2rem;left:50%;transform:translateX(-50%) translateY(10px);background:rgba(15,15,15,0.97);backdrop-filter:var(--blur);border:1px solid var(--border2);border-radius:8px;padding:.65rem 1.2rem;font-size:.82rem;color:var(--text);z-index:999;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap;box-shadow:0 10px 30px rgba(0,0,0,.5);}
.toast.show{transform:translateX(-50%) translateY(0);opacity:1;}
.pwd-modal{position:fixed;inset:0;background:rgba(5,5,5,0.92);backdrop-filter:blur(12px);z-index:600;display:none;align-items:center;justify-content:center;padding:1rem;}
.pwd-modal.open{display:flex;}
.pwd-box{background:rgba(15,15,15,0.97);border:1px solid var(--border2);border-radius:12px;padding:1.8rem;width:100%;max-width:320px;text-align:center;}
.pwd-title{font-family:'Playfair Display',serif;font-size:1.1rem;color:var(--white);margin-bottom:.3rem;}
.pwd-sub{font-size:.8rem;color:var(--muted);margin-bottom:1.2rem;}

/* ── FOOTER ── */
footer{background:#080808;border-top:1px solid var(--border);padding:2rem 1.2rem;text-align:center;margin-top:2rem;}
.footer-logo{margin-bottom:.8rem;}
.footer-logo img{height:38px;width:auto;object-fit:contain;border-radius:6px;}
.footer-links{display:flex;gap:1rem;justify-content:center;margin-bottom:1rem;flex-wrap:wrap;}
.footer-links span,.footer-links a{font-size:.75rem;color:var(--muted2);cursor:pointer;text-decoration:none;transition:color .2s;}
.footer-links span:hover,.footer-links a:hover{color:var(--accent);}
.footer-disclaimer{font-size:.68rem;color:#3a3a3a;line-height:1.7;max-width:600px;margin:0 auto .8rem;}
.footer-copy{font-size:.62rem;color:#2a2a2a;}

/* ── RELATED ROW ── */
.related-section{padding:1rem 0 1rem 1.2rem;}

/* ── DESKTOP OVERRIDES ── */
@media(min-width:768px){
  header{padding:0 2rem;height:66px;}
  .logo img{height:48px;}
  .search-icon-btn{display:none;}
  .header-search-desktop{display:flex;}
  .header-search-bar{display:none !important;}
  .hamburger{display:none;}
  .side-menu,.menu-overlay{display:none !important;}
  .header-right-actions{display:none;}

  /* Desktop nav inline */
  .desktop-nav{display:flex;align-items:center;gap:.4rem;}
  .desktop-nav-btn{background:var(--glass);border:1px solid var(--border);color:var(--muted);font-family:'Outfit',sans-serif;font-size:.78rem;cursor:pointer;padding:6px 12px;border-radius:4px;transition:all .2s;white-space:nowrap;}
  .desktop-nav-btn:hover{color:var(--white);background:var(--glass2);}
  .desktop-nav-btn.highlight{background:linear-gradient(135deg,rgba(229,9,20,0.2),rgba(229,9,20,0.1));border-color:rgba(229,9,20,0.4);color:var(--accent);font-weight:600;}

  /* Desktop user widget */
  .desktop-user{display:flex;align-items:center;gap:.5rem;background:var(--glass);border:1px solid var(--border);border-radius:6px;padding:4px 10px 4px 8px;}
  .du-avatar{font-size:1.1rem;}
  .du-name{font-size:.75rem;color:var(--white);}
  .du-name strong{color:var(--accent);}
  .logout-btn-desk{background:transparent;border:1px solid rgba(229,9,20,0.3);color:rgba(229,9,20,0.7);font-family:'Outfit',sans-serif;font-size:.7rem;padding:3px 9px;border-radius:4px;cursor:pointer;transition:all .2s;}
  .logout-btn-desk:hover{background:rgba(229,9,20,0.15);color:var(--accent);}

  .hero{height:480px;max-height:520px;}
  .hero-content{padding:3rem 2.5rem;max-width:560px;}
  .detail-content{flex-direction:row;padding:2.5rem;align-items:flex-end;}
  .detail-poster{width:140px;min-width:140px;}
  .detail-row{flex-direction:row;}
  .player-section{padding:1.5rem 2.5rem;}
  .row-section{padding:1.5rem 0 1.5rem 2rem;}
  .row-scroll .card{flex:0 0 155px;width:155px;}
  .cards-grid{grid-template-columns:repeat(auto-fill,minmax(170px,1fr));}
  .genre-bar{padding:1rem 2rem;}
  .estrenos-banner{min-height:200px;}
  .estrenos-title{font-size:2rem;}
  .estrenos-poster-thumb{width:100px;min-width:100px;}
  .estrenos-banner-content{padding:1.5rem 2rem;}
}
</style>
</head>
<body>

<!-- ══ HEADER ══ -->
<header>
  <div class="logo" onclick="goHome()">
    <img src="https://elfilme.com/copilot_image_1772812453252.jpeg" alt="ElFilme"/>
  </div>

  <!-- Desktop search -->
  <div class="header-search-desktop">
    <svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input type="text" id="headerSearchDesk" placeholder="Buscar películas, series..." oninput="liveSearch(this.value)" onkeydown="if(event.key==='Enter')doSearch(this.value)"/>
  </div>

  <!-- Desktop nav -->
  <nav class="desktop-nav" id="desktopNav">
    <button class="desktop-nav-btn" onclick="goHome()">Inicio</button>
    <button class="desktop-nav-btn highlight" onclick="location.href='/estrenos'">Estrenos</button>
    <button class="desktop-nav-btn" onclick="location.href='/noticiero'">Noticiero</button>
    <button class="desktop-nav-btn" onclick="location.href='/live'" style="color:#e50914;">● En Vivo</button>
    <button class="desktop-nav-btn" onclick="showFavorites()">Favoritos <span id="favCountDesk">0</span></button>
    <button class="desktop-nav-btn" onclick="openInfoModal('contact')">Contacto</button>
  </nav>

  <!-- Desktop user -->
  <div class="desktop-user">
    <span class="du-name">Hola, <strong id="session-name-desk">—</strong></span>
    <button class="logout-btn-desk" onclick="logout()">Salir</button>
  </div>
  <button class="admin-btn" onclick="openAdminGate()">+ Admin</button>

  <!-- Mobile right -->
  <div class="header-right-actions" id="mobileActions">
    <button class="search-icon-btn" onclick="toggleMobileSearch()" title="Buscar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    </button>
    <button class="fav-btn" onclick="showFavorites()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      <span class="fav-count" id="favCount">0</span>
    </button>
    <button class="hamburger" id="hamburger" onclick="toggleMenu()">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>

<!-- Mobile search bar -->
<div class="header-search-bar" id="mobileSearchBar">
  <svg class="search-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
  <input type="text" id="headerSearchMob" placeholder="Buscar películas, series..." oninput="liveSearch(this.value)" onkeydown="if(event.key==='Enter')doSearch(this.value)"/>
</div>

<!-- Menu overlay — z-index BAJO el menú, ALTO que el resto -->
<div class="menu-overlay" id="menuOverlay" onclick="closeMenu()"></div>

<!-- Slide-in side menu -->
<nav class="side-menu" id="sideMenu">
  <div class="menu-user">
    <div class="menu-user-name"><strong id="session-name">—</strong></div>
    <div class="menu-user-sub">Miembro VIP · ElFilme</div>
  </div>

  <div class="menu-section-label">Navegación</div>
  <div class="menu-item" onclick="goHome();closeMenu()">
    <svg class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    Inicio
  </div>
  <div class="menu-item" onclick="showFavorites();closeMenu()">
    <svg class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    Mis Favoritos
    <span class="menu-item-badge" id="favCountMenu">0</span>
  </div>

  <div class="menu-divider"></div>
  <div class="menu-section-label">Contenido</div>

  <div class="menu-item" onclick="location.href='/estrenos'">
    <svg class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>
    Estrenos
    <span class="menu-item-new">NOW</span>
  </div>
  <div class="menu-item" onclick="location.href='/noticiero'">
    <svg class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z"/></svg>
    Noticiero
  </div>
  <div class="menu-item" onclick="location.href='/live'">
    <svg class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="12" cy="12" r="2"/><path d="M16.72 7.28a6 6 0 0 1 0 8.49M7.28 16.72a6 6 0 0 1 0-8.49M19.56 4.44a10 10 0 0 1 0 15.12M4.44 19.56a10 10 0 0 1 0-15.12"/></svg>
    En Vivo
    <span class="menu-item-badge" style="background:#e50914;animation:pulse 1.5s infinite;">LIVE</span>
  </div>

  <div class="menu-divider"></div>
  <div class="menu-section-label">Más</div>
  <div class="menu-item" onclick="openInfoModal('contact');closeMenu()">
    <svg class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
    Contacto
  </div>
  <div class="menu-item" onclick="openInfoModal('terms');closeMenu()">
    <svg class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
    Términos
  </div>
  <div class="menu-item" onclick="openAdminGate();closeMenu()">
    <svg class="menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    Admin
  </div>

  <div class="menu-bottom">
    <button class="logout-menu-btn" onclick="logout()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Cerrar Sesión
    </button>
  </div>
</nav>

<!-- VIP BANNER -->
<div class="vip-banner">
  <span class="vip-banner-text">VIP · Bienvenido, <span class="vip-banner-name" id="vip-username">Usuario</span></span>
</div>

<!-- ══ ESTRENOS PREMIUM BANNER ══ -->
<div class="estrenos-banner" id="estrenosBanner" onclick="window.location.href='/estrenos'" title="Ver Estrenos">
  <div class="estrenos-banner-bg" id="estrenosBg"></div>
  <div class="estrenos-banner-overlay"></div>
  <div class="estrenos-banner-content">
    <div class="estrenos-poster-thumb" id="estrenosPoster">
      <img id="estrenosPosterImg" src="" alt="" onerror="this.style.display='none'"/>
    </div>
    <div class="estrenos-text">
      <div class="estrenos-badge-row">
        <span class="now-playing-badge">NOW IN THEATERS</span>
        <span class="estrenos-label-badge">ESTRENOS VIP</span>
      </div>
      <div class="estrenos-title" id="estrenosTitle">CARGANDO...</div>
      <div class="estrenos-subtitle" id="estrenosSubtitle">Cartelera exclusiva ElFilme</div>
      <a class="estrenos-cta" onclick="event.stopPropagation();window.location.href='/estrenos'">▶ Ver Cartelera Completa</a>
    </div>
    <div class="estrenos-right">
      <div class="estrenos-count-badge">
        <div class="estrenos-count-num" id="estrenosCount">—</div>
        <span class="estrenos-count-label">ESTRENOS</span>
      </div>
    </div>
  </div>
  <div class="estrenos-ticker">
    <div class="estrenos-ticker-inner" id="estrenosTicker">
      ● ESTRENOS EN CARTELERA &nbsp;&nbsp;&nbsp; ● EXCLUSIVO VIP &nbsp;&nbsp;&nbsp; ● ELFILME.COM &nbsp;&nbsp;&nbsp; ● NUEVOS TÍTULOS &nbsp;&nbsp;&nbsp; ● ESTRENOS EN CARTELERA &nbsp;&nbsp;&nbsp; ● EXCLUSIVO VIP &nbsp;&nbsp;&nbsp;
    </div>
  </div>
</div>

<!-- ══ PAGE: HOME ══ -->
<div class="page active" id="page-home">
  <div class="hero" id="heroSection">
    <div class="hero-bg"><div style="width:100%;height:100%;background:linear-gradient(135deg,#0d0d0d,#1a0000)"></div></div>
    <div class="hero-overlay"></div>
    <div class="hero-content" id="heroContent">
      <div style="color:var(--muted);font-size:.85rem">Cargando contenido...</div>
    </div>
  </div>
  <div class="genre-bar" id="genreBar"><button class="genre-pill active" onclick="filterGenre('All',this)">Todos</button></div>
  <div id="sectionsContainer"></div>
  <div class="empty-state" id="homeEmpty" style="display:none">
    <div class="empty-icon" style="font-family:Bebas Neue,cursive;font-size:2.5rem;color:#333;letter-spacing:.2em">ELFILME</div>
    <div class="empty-title">Sin contenido</div>
    <p style="font-size:.85rem;color:var(--muted2);margin-top:.4rem">Verifica tu conexión a internet.</p>
  </div>
</div>

<!-- ══ PAGE: DETAIL ══ -->
<div class="page" id="page-detail">
  <div class="detail-hero">
    <div class="detail-hero-bg" id="detailHeroBg"><div style="width:100%;height:100%;background:linear-gradient(135deg,#0d0d0d,#1a0000)"></div></div>
    <div class="detail-overlay"></div>
    <div class="detail-content">
      <div class="detail-row">
        <div class="detail-poster" id="detailPoster"></div>
        <div class="detail-info">
          <div class="detail-title" id="detailTitle"></div>
          <div class="detail-tagline" id="detailTagline"></div>
          <div class="detail-meta" id="detailMeta"></div>
          <div class="genre-tags" id="detailGenres"></div>
        </div>
      </div>
      <div class="detail-desc" id="detailDesc"></div>
      <div class="detail-btns" id="detailBtns"></div>
    </div>
  </div>
  <div class="player-section" id="playerSection" style="display:none">
    <div class="player-wrap" id="playerWrap"></div>
    <div class="source-tabs" id="sourceTabs"></div>
    <div class="likes-bar" id="likesBar" style="display:none">
      <button class="like-btn" id="likeBtn" onclick="toggleLike()">
        <span class="like-heart">♥</span><span id="likeBtnText">Me gusta</span>
      </button>
      <span class="like-count" id="likeCount"></span>
    </div>
  </div>
  <div class="related-section" id="relatedSection" style="display:none">
    <div class="section-header" style="padding-right:1.2rem">
      <h2 class="section-title-line">También te puede gustar</h2>
    </div>
    <div class="row-scroll" id="relatedGrid"></div>
  </div>
</div>

<!-- ══ PAGE: FAVORITES ══ -->
<div class="page" id="page-favorites">
  <div style="padding:1.5rem 1.2rem">
    <div class="section-header"><h2 class="section-title-line">Mis Favoritos</h2></div>
    <div class="cards-grid" id="favsGrid"></div>
    <div class="empty-state" id="favsEmpty" style="display:none">
      <div class="empty-icon" style="font-size:2rem;color:#444">—</div>
      <div class="empty-title">Sin favoritos aún</div>
      <p style="font-size:.85rem;color:var(--muted2);margin-top:.4rem">Toca ♥ en cualquier título para guardarlo.</p>
    </div>
  </div>
</div>

<!-- ══ PAGE: SEARCH ══ -->
<div class="page" id="page-search">
  <div class="search-header">
    <div class="search-query">Resultados para <span id="searchQueryDisplay"></span></div>
    <div class="search-count" id="searchCountDisplay"></div>
  </div>
  <div style="padding:1rem 1.2rem">
    <div class="cards-grid" id="searchGrid"></div>
    <div class="empty-state" id="searchEmpty" style="display:none">
      <div class="empty-icon">🔍</div>
      <div class="empty-title">Sin resultados</div>
    </div>
  </div>
</div>

<!-- ══ FOOTER ══ -->
<footer>
  <div class="footer-logo"><img src="https://elfilme.com/copilot_image_1772812453252.jpeg" alt="ElFilme"/></div>
  <div class="footer-links">
    <span onclick="openInfoModal('terms')">Términos</span>
    <span onclick="openInfoModal('contact')">Contacto</span>
    <span onclick="window.location.href='/estrenos'">Estrenos</span>
    <span onclick="window.location.href='/noticiero'">Noticiero</span>
  </div>
  <p class="footer-disclaimer">NOTA LEGAL — ElFilme.com no aloja, sube ni almacena contenido de video en sus servidores. Todo el contenido multimedia está integrado desde plataformas de terceros. No nos responsabilizamos por la disponibilidad o legalidad del contenido. Todos los derechos pertenecen a sus respectivos dueños.</p>
  <p class="footer-copy">© 2025 ElFilme.com — Todos los derechos reservados</p>
</footer>

<!-- ══ PWD MODAL ══ -->
<div class="pwd-modal" id="pwdModal">
  <div class="pwd-box">
    <div class="pwd-title">Acceso Admin</div>
    <div class="pwd-sub">Ingresa tu contraseña</div>
    <input class="form-input" type="password" id="pwdInput" placeholder="Contraseña" onkeydown="if(event.key==='Enter')checkPwd()"/>
    <div style="display:flex;gap:.6rem;margin-top:.9rem;">
      <button class="btn-cancel" style="flex:1" onclick="closePwdModal()">Cancelar</button>
      <button class="btn-save" style="flex:1" onclick="checkPwd()">Entrar</button>
    </div>
    <div id="pwdError" style="color:var(--danger);font-size:.75rem;margin-top:.5rem;display:none">Contraseña incorrecta</div>
  </div>
</div>

<!-- ══ ADMIN MODAL ══ -->
<div class="modal-overlay" id="adminModal">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">Content Manager</span>
      <button class="modal-close" onclick="closeAdmin()">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-tabs">
        <div class="modal-tab active" onclick="switchAdminTab('add',this)">Agregar</div>
        <div class="modal-tab" onclick="switchAdminTab('manage',this)">Gestionar (<span id="contentCount">0</span>)</div>
        <div class="modal-tab" onclick="switchAdminTab('settings',this)">Ajustes</div>
      </div>
      <div class="modal-tab-content active" id="admin-add">
        <div class="form-grid">
          <div class="form-group"><label class="form-label">TÍTULO *</label><input class="form-input" id="f-title" placeholder="Título de película o serie"/></div>
          <div class="form-group"><label class="form-label">TIPO *</label><select class="form-select" id="f-type"><option value="movie">Película</option><option value="series">Serie</option></select></div>
          <div class="form-group"><label class="form-label">AÑO</label><input class="form-input" id="f-year" placeholder="2025" type="number"/></div>
          <div class="form-group"><label class="form-label">RATING (0-10)</label><input class="form-input" id="f-rating" placeholder="8.5" type="number" step="0.1" min="0" max="10"/></div>
          <div class="form-group"><label class="form-label">GÉNERO</label><select class="form-select" id="f-genre"><option>Acción</option><option>Aventura</option><option>Animación</option><option>Comedia</option><option>Crimen</option><option>Documental</option><option>Drama</option><option>Fantasía</option><option>Terror</option><option>Misterio</option><option>Romance</option><option>Sci-Fi</option><option>Thriller</option></select></div>
          <div class="form-group"><label class="form-label">DURACIÓN</label><input class="form-input" id="f-duration" placeholder="120 min o 3 Temporadas"/></div>
          <div class="form-group full"><label class="form-label">URL PÓSTER</label><input class="form-input" id="f-poster" placeholder="https://image.tmdb.org/..."/></div>
          <div class="form-group full"><label class="form-label">DESCRIPCIÓN</label><textarea class="form-textarea" id="f-desc" placeholder="Descripción breve..."></textarea></div>
          <div class="form-group full"><label class="form-label">VIDEO FUENTE 1 (embed URL)</label><input class="form-input" id="f-src1" placeholder="https://www.youtube.com/embed/VIDEO_ID"/></div>
          <div class="form-group full"><label class="form-label">ETIQUETA FUENTE 1</label><input class="form-input" id="f-src1label" placeholder="Tráiler"/></div>
          <div class="form-group full"><label class="form-label">VIDEO FUENTE 2</label><input class="form-input" id="f-src2" placeholder="https://vidsrc.me/embed/..."/></div>
          <div class="form-group full"><label class="form-label">ETIQUETA FUENTE 2</label><input class="form-input" id="f-src2label" placeholder="Ver Película"/></div>
          <div class="form-group full"><label class="form-label">VIDEO FUENTE 3</label><input class="form-input" id="f-src3" placeholder="https://archive.org/embed/..."/></div>
          <div class="form-group full"><label class="form-label">ETIQUETA FUENTE 3</label><input class="form-input" id="f-src3label" placeholder="Archive.org"/></div>
          <div class="form-group full"><label class="form-label">🇲🇽 FUENTE ESPAÑOL</label><input class="form-input" id="f-src4" placeholder="https://..."/></div>
          <div class="form-group full"><label class="form-label">ETIQUETA ESPAÑOL</label><input class="form-input" id="f-src4label" placeholder="Audio Español"/></div>
        </div>
        <div class="form-footer">
          <button class="btn-cancel" onclick="clearForm()">Limpiar</button>
          <button class="btn-save" onclick="saveContent()">Guardar</button>
        </div>
        <input type="hidden" id="f-editId"/>
      </div>
      <div class="modal-tab-content" id="admin-manage">
        <div class="admin-list" id="adminList"></div>
        <div class="empty-state" id="adminEmpty" style="padding:2rem;display:none"><div style="font-size:.85rem;color:var(--muted)">Sin contenido aún.</div></div>
      </div>
      <div class="modal-tab-content" id="admin-settings">
        <div class="form-group" style="margin-bottom:1rem"><label class="form-label">NOMBRE DEL SITIO</label><input class="form-input" id="s-sitename" placeholder="Synapt Cinema"/></div>
        <div class="form-group" style="margin-bottom:1rem"><label class="form-label">CAMBIAR CONTRASEÑA</label><input class="form-input" type="password" id="s-newpwd" placeholder="Nueva contraseña"/></div>
        <div class="form-group" style="margin-bottom:1.5rem"><label class="form-label">DESTACADO HERO</label><input class="form-input" id="s-featured" placeholder="Título del featured"/></div>
        <button class="btn-save" onclick="saveSettings()">Guardar Ajustes</button>
        <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);">
          <div style="font-size:.75rem;color:var(--muted);margin-bottom:.7rem;">Zona Peligrosa</div>
          <button class="btn-del" onclick="clearAllContent()">Borrar Todo</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- CONTACT MODAL -->
<div class="modal-overlay" id="modal-contact">
  <div class="modal" style="max-width:440px;">
    <div class="modal-header">
      <span class="modal-title">Contacto</span>
      <button class="modal-close" onclick="closeInfoModal('contact')">✕</button>
    </div>
    <div class="modal-body">
      <div style="background:var(--glass);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:.7rem;">
        <div style="font-size:.7rem;color:var(--muted);margin-bottom:.3rem;letter-spacing:.05em;">EMAIL</div>
        <div style="color:var(--accent);font-size:.9rem;"><a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="f392979e9a9db3969f959a9f9e96dd909c9e">[email&#160;protected]</a></div>
      </div>
      <div style="background:var(--glass);border:1px solid var(--border);border-radius:8px;padding:1rem;">
        <div style="font-size:.7rem;color:var(--muted);margin-bottom:.3rem;letter-spacing:.05em;">SITIO WEB</div>
        <a href="https://elfilme.com" target="_blank" style="color:var(--accent);font-size:.9rem;text-decoration:none;">elfilme.com</a>
      </div>
    </div>
  </div>
</div>

<!-- TERMS MODAL -->
<div class="modal-overlay" id="modal-terms">
  <div class="modal" style="max-width:580px;">
    <div class="modal-header">
      <span class="modal-title">Términos y Condiciones</span>
      <button class="modal-close" onclick="closeInfoModal('terms')">✕</button>
    </div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto;">
      <div style="font-size:.83rem;color:var(--muted);line-height:1.9;">
        <p style="margin-bottom:1rem;color:var(--text)"><strong>Última actualización: 2025</strong></p>
        <p style="margin-bottom:.6rem;color:var(--accent);font-weight:600;">Aviso Legal</p>
        <p style="margin-bottom:1rem;">ElFilme.com no aloja, sube ni almacena contenido de video en sus servidores. Todo el contenido multimedia es integrado desde plataformas de terceros como YouTube, Vidsrc y Archive.org. No somos responsables de la disponibilidad o legalidad del contenido embebido.</p>
        <p style="margin-bottom:.6rem;color:var(--accent);font-weight:600;">Uso del Servicio</p>
        <p style="margin-bottom:1rem;">Este sitio es solo para fines informativos y de entretenimiento. Al usar el sitio, aceptas no utilizarlo para ningún propósito ilegal.</p>
        <p style="margin-bottom:.6rem;color:var(--accent);font-weight:600;">Derechos de Autor</p>
        <p>Todas las marcas y logotipos pertenecen a sus respectivos dueños. Si crees que tu contenido se muestra sin autorización, contáctanos y lo eliminamos de inmediato.</p>
      </div>
    </div>
  </div>
</div>

<!-- TOAST -->
<div class="toast" id="toast"></div>

<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script><script>
// ── Sesión ──
(function(){
  const raw=localStorage.getItem('elfilme_user');
  if(!raw){window.location.href='/login';return;}
  try{
    const u=JSON.parse(raw);
    const setEl=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
    setEl('session-name',u.username||'Usuario');
    setEl('session-name-desk',u.username||'Usuario');
    setEl('vip-username',u.username||'Usuario');
  }catch(e){window.location.href='/login';}
})();

function logout(){
  if(!confirm('¿Cerrar sesión?'))return;
  localStorage.removeItem('elfilme_user');
  window.location.href='/login';
}

// ── Mobile menu ──
function toggleMenu(){
  const menu=document.getElementById('sideMenu');
  const ham=document.getElementById('hamburger');
  const overlay=document.getElementById('menuOverlay');
  const open=menu.classList.toggle('open');
  ham.classList.toggle('open',open);
  overlay.classList.toggle('open',open);
}
function closeMenu(){
  document.getElementById('sideMenu').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
  document.getElementById('menuOverlay').classList.remove('open');
}

// ── Mobile search ──
function toggleMobileSearch(){
  const bar=document.getElementById('mobileSearchBar');
  bar.classList.toggle('open');
  if(bar.classList.contains('open'))document.getElementById('headerSearchMob').focus();
}

// ── Estrenos Banner ──
const ESTRENOS_BIN='69ce041936566621a870294e';
const MASTER_KEY='$2a$10$2FU4DfoZscB5BrItbrVx3ezRVN5ynuE1zH1Zy3X6IW5NP8p3pigwe';

async function loadEstrenosBanner(){
  try{
    const res=await fetch(\`https://api.jsonbin.io/v3/b/\${ESTRENOS_BIN}/latest\`,{headers:{'X-Master-Key':MASTER_KEY}});
    if(!res.ok)return;
    const data=await res.json();
    const pelis=data.record;
    if(!pelis||!pelis.length)return;

    const feat=pelis[0];
    document.getElementById('estrenosTitle').textContent=feat.title||'Estrenos VIP';
    document.getElementById('estrenosSubtitle').textContent=feat.category?\`Categoría: \${feat.category}\`:'Cartelera exclusiva ElFilme';
    document.getElementById('estrenosCount').textContent=pelis.length;

    if(feat.poster){
      document.getElementById('estrenosBg').style.backgroundImage=\`url(\${feat.poster})\`;
      document.getElementById('estrenosPosterImg').src=feat.poster;
      document.getElementById('estrenosPosterImg').alt=feat.title;
    }

    // Ticker con todos los títulos
    const titles=pelis.slice(0,10).map(p=>\`● \${p.title}\`).join('  &nbsp;&nbsp;&nbsp;  ');
    document.getElementById('estrenosTicker').innerHTML=titles+'  &nbsp;&nbsp;&nbsp;  '+titles;
  }catch(e){
    document.getElementById('estrenosTitle').textContent='Estrenos VIP';
  }
}

// ── CONFIG ──
// TMDB Read Access Token — no tiene restricción de dominio
const TMDB_TOKEN='eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ik5UWXlNakk1UWtSR1JURkZOVUV3TlVZeVJqazBSakJCTVRBMU5USTJNVGc0UlVFd01BIn0';
const TMDB_KEY='14c15425ed275359fc0fc82fbbda1e62'; // fallback
const TMDB='https://api.themoviedb.org/3';
const IMG='https://image.tmdb.org/t/p/w500';
const MASTER_KEY_BIN='$2a$10$2FU4DfoZscB5BrItbrVx3ezRVN5ynuE1zH1Zy3X6IW5NP8p3pigwe';
const ESTRENOS_BIN_ID='69ce041936566621a870294e';

// Géneros TMDB → español
const GENRE_MAP={28:'Acción',12:'Aventura',16:'Animación',35:'Comedia',80:'Crimen',99:'Documental',18:'Drama',10751:'Familia',14:'Fantasía',36:'Historia',27:'Terror',10402:'Música',9648:'Misterio',10749:'Romance',878:'Sci-Fi',10770:'TV Movie',53:'Thriller',10752:'Guerra',37:'Western',10759:'Acción',10762:'Infantil',10763:'Noticias',10764:'Reality',10765:'Sci-Fi',10766:'Telenovela',10767:'Talk Show',10768:'Guerra'};

let DB=[];
let DB_SECTIONS={};
let FAV=JSON.parse(localStorage.getItem('synaptstream_fav')||'[]');
let SETTINGS=JSON.parse(localStorage.getItem('synaptstream_settings')||'{"sitename":"ElFilme","pwd":"admin123","featured":""}');
let currentGenre='All';
let searchTimeout=null;

function tmdbToCard(item,type='movie'){
  const genres=(item.genre_ids||[]).map(id=>GENRE_MAP[id]).filter(Boolean);
  const t=item.media_type||type;
  return {
    id:'tmdb_'+(item.id||Math.random()),
    title:item.title||item.name||'Sin título',
    type:t==='tv'?'series':'movie',
    year:(item.release_date||item.first_air_date||'').slice(0,4),
    rating:item.vote_average?Number(item.vote_average).toFixed(1):'—',
    genre:genres[0]||'Drama',
    genres:genres,
    poster:item.poster_path?IMG+item.poster_path:null,
    backdrop:item.backdrop_path?'https://image.tmdb.org/t/p/original'+item.backdrop_path:null,
    desc:item.overview||'',
    tmdbId:item.id,
    src1:t==='tv'?\`https://vidsrc.to/embed/tv/\${item.id}\`:\`https://vidsrc.to/embed/movie/\${item.id}\`,
    src1label:'▶ Ver Ahora',
    src2:t==='tv'?\`https://vidsrc.xyz/embed/tv?tmdb=\${item.id}\`:\`https://vidsrc.xyz/embed/movie?tmdb=\${item.id}\`,
    src2label:'Fuente 2',
  };
}

async function fetchTMDB(endpoint,extraParams=''){
  // API key v3 — funciona desde cualquier dominio sin CORS issues
  const url=\`\${TMDB}\${endpoint}?api_key=\${TMDB_KEY}&language=es-MX&page=1\${extraParams}\`;
  try{
    const res=await fetch(url);
    if(!res.ok)return[];
    const d=await res.json();
    return d.results||[];
  }catch(e){return[];}
}

async function initDB(){
  renderHome(true);showLoader(true);
  DB_SECTIONS={};

  // ── PASO 1: Cargar estrenos bin PRIMERO (siempre funciona) ──
  let estrenosDB=[];
  try{
    const er=await fetch(\`https://api.jsonbin.io/v3/b/\${ESTRENOS_BIN_ID}/latest\`,{headers:{'X-Master-Key':MASTER_KEY_BIN}});
    if(er.ok){
      const ed=await er.json();
      const raw=ed.record;
      if(Array.isArray(raw)&&raw.length){
        estrenosDB=raw.map((p,i)=>({
          id:'estreno_'+(p.id||i),
          title:p.title||p.name||'—',
          type:'movie',
          year:(p.release_date||'').slice(0,4),
          rating:p.vote_average?Number(p.vote_average).toFixed(1):'—',
          genre:p.category||'Estreno',
          genres:[p.category||'Estreno'],
          poster:p.poster||null,
          backdrop:p.backdrop||null,
          desc:p.overview||p.description||'',
          src1:p.url_stream||\`https://vidsrc.to/embed/movie/\${p.id}\`,
          src1label:'▶ Ver Estreno',
          src2:\`https://vidsrc.xyz/embed/movie?tmdb=\${p.id}\`,
          src2label:'Fuente 2',
          isEstreno:true,
        }));
      }
    }
  }catch(e){}

  // Mostrar estrenos de inmediato mientras carga TMDB
  DB_SECTIONS={'estrenos':estrenosDB};
  DB=[...estrenosDB];
  showLoader(false);
  renderHomeSections();
  updateFavCount();
  loadEstrenosBanner();

  // ── PASO 2: Intentar cache TMDB reciente ──
  const cache=localStorage.getItem('elfilme_db_cache');
  if(cache){
    try{
      const c=JSON.parse(cache);
      if(Date.now()-c.ts < 60*60*1000){ // 1 hora
        const sec=c.sections||{};
        sec.estrenos=estrenosDB; // siempre usar estrenos frescos
        DB_SECTIONS=sec;
        DB=[...estrenosDB,...(DB.slice(estrenosDB.length))];
        renderHomeSections();
        return;
      }
    }catch(e){}
  }

  // ── PASO 3: Cargar TMDB en paralelo ──
  const results=await Promise.allSettled([
    fetchTMDB('/trending/all/week'),
    fetchTMDB('/movie/popular'),
    fetchTMDB('/movie/top_rated'),
    fetchTMDB('/movie/now_playing'),
    fetchTMDB('/movie/upcoming'),
    fetchTMDB('/tv/popular'),
    fetchTMDB('/tv/top_rated'),
    fetchTMDB('/discover/movie','&with_genres=28&sort_by=popularity.desc'),
    fetchTMDB('/discover/movie','&with_genres=27&sort_by=popularity.desc'),
    fetchTMDB('/discover/movie','&with_genres=16&sort_by=popularity.desc'),
  ]);

  const get=(i)=>results[i].status==='fulfilled'?results[i].value:[];
  const trending=get(0),popular=get(1),topRated=get(2),nowPlaying=get(3),
        upcomingMovies=get(4),popularSeries=get(5),topSeries=get(6),
        actionMovies=get(7),horrorMovies=get(8),animacion=get(9);

  const totalTMDB=trending.length+popular.length+topRated.length;

  if(totalTMDB>0){
    DB_SECTIONS={
      'estrenos': estrenosDB,
      'trending': trending.map(i=>tmdbToCard(i,i.media_type||'movie')),
      'now_playing': nowPlaying.map(i=>tmdbToCard(i,'movie')),
      'popular': popular.map(i=>tmdbToCard(i,'movie')),
      'top_rated': topRated.map(i=>tmdbToCard(i,'movie')),
      'upcoming': upcomingMovies.map(i=>tmdbToCard(i,'movie')),
      'series': [...popularSeries.map(i=>tmdbToCard(i,'tv')),...topSeries.map(i=>tmdbToCard(i,'tv'))],
      'accion': actionMovies.map(i=>tmdbToCard(i,'movie')),
      'terror': horrorMovies.map(i=>tmdbToCard(i,'movie')),
      'animacion': animacion.map(i=>tmdbToCard(i,'movie')),
    };

    const seen=new Set();
    DB=[...estrenosDB];
    [...trending,...popular,...topRated,...nowPlaying,...upcomingMovies,
     ...popularSeries,...topSeries,...actionMovies,...horrorMovies,...animacion
    ].forEach(i=>{
      if(!seen.has(i.id)){seen.add(i.id);DB.push(tmdbToCard(i,i.media_type||'movie'));}
    });

    try{localStorage.setItem('elfilme_db_cache',JSON.stringify({ts:Date.now(),sections:DB_SECTIONS}));}catch(e){}
    renderHomeSections();
    renderHero();
  }
  // Si TMDB falla, ya se están mostrando los estrenos del paso 1
}

// save() — solo favoritos y settings locales ahora
async function save(){
  localStorage.setItem('synaptstream_fav',JSON.stringify(FAV));
  localStorage.setItem('synaptstream_settings',JSON.stringify(SETTINGS));
}

function showLoader(show){
  let el=document.getElementById('globalLoader');
  if(!el){
    el=document.createElement('div');el.id='globalLoader';
    el.style.cssText='position:fixed;inset:0;background:rgba(10,10,10,.97);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;font-family:Outfit,sans-serif;';
    el.innerHTML=\`<div style="font-family:Bebas Neue,cursive;font-size:2rem;letter-spacing:.3em;color:#e50914">ELFILME</div><div style="color:#e50914;font-size:.85rem;letter-spacing:.2em;margin-top:.5rem">CARGANDO...</div>\`;
    document.body.appendChild(el);
  }
  el.style.display=show?'flex':'none';
}

function toast(msg,ok=true){
  const t=document.getElementById('toast');
  t.textContent=msg;t.style.borderColor=ok?'var(--accent)':'var(--danger)';
  t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);
}

function showPage(id){
  const current=document.querySelector('.page.active');
  if(current){
    current.style.opacity='0';current.style.transform='translateY(8px)';
    setTimeout(()=>{
      document.querySelectorAll('.page').forEach(p=>{p.classList.remove('active');p.style.opacity='';p.style.transform='';});
      const next=document.getElementById('page-'+id);next.classList.add('active');window.scrollTo(0,0);
    },180);
  }else{
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById('page-'+id).classList.add('active');window.scrollTo(0,0);
  }
}

function goHome(){currentGenre='All';renderHomeSections();showPage('home');}

function renderHomeSections(skeleton=false){
  updateFavCount();
  const container=document.getElementById('sectionsContainer');
  if(!container)return;

  if(skeleton){
    container.innerHTML=\`
      <div class="row-section"><div class="section-header"><h2 class="section-title-line">Tendencias</h2></div><div class="row-scroll">\${Array(6).fill('<div class="card skeleton skeleton-card"></div>').join('')}</div></div>
      <div class="row-section"><div class="section-header"><h2 class="section-title-line">En Cines</h2></div><div class="row-scroll">\${Array(6).fill('<div class="card skeleton skeleton-card"></div>').join('')}</div></div>
    \`;
    document.getElementById('homeEmpty').style.display='none';
    return;
  }

  const sections=[
    {key:'estrenos',label:'Estrenos VIP',show:true},
    {key:'trending',label:'Tendencias Esta Semana',show:true},
    {key:'now_playing',label:'Ahora en Cines',show:true},
    {key:'popular',label:'Películas Populares',show:true},
    {key:'series',label:'Series Populares',show:true},
    {key:'top_rated',label:'Mejor Calificadas',show:true},
    {key:'accion',label:'Acción',show:true},
    {key:'terror',label:'Terror',show:true},
    {key:'animacion',label:'Animación',show:true},
    {key:'upcoming',label:'Próximos Estrenos',show:true},
  ];

  let html='';
  let totalItems=0;

  sections.forEach(sec=>{
    let items=DB_SECTIONS[sec.key]||[];
    // Filtrar por género si hay uno activo
    if(currentGenre!=='All'){
      items=items.filter(c=>(c.genre===currentGenre)||(c.genres&&c.genres.includes(currentGenre)));
    }
    if(!items.length)return;
    totalItems+=items.length;
    const uid='sec_'+sec.key;
    html+=\`<div class="row-section">
      <div class="section-header" style="padding-right:1.2rem">
        <h2 class="section-title-line">\${sec.label}</h2>
      </div>
      <div class="row-scroll" id="\${uid}">
        \${items.slice(0,20).map(c=>cardHTML(c)).join('')}
      </div>
    </div>\`;
  });

  document.getElementById('homeEmpty').style.display=totalItems===0?'block':'none';
  container.innerHTML=html;
  renderGenreBar();
  renderHero();
}

function renderHome(skeleton=false){
  renderHomeSections(skeleton);
}

function cardHTML(c){
  const isFav=FAV.includes(c.id);
  const poster=c.poster
    ?\`<img class="card-poster" src="\${c.poster}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"/><div class="card-poster-placeholder" style="display:none">\${c.type==='movie'?'🎬':'📺'}</div>\`
    :\`<div class="card-poster-placeholder">\${c.type==='movie'?'🎬':'📺'}</div>\`;
  return \`<div class="card" onclick="openDetail('\${c.id}')">
    \${poster}
    <div class="card-type-badge">\${c.type==='movie'?'MOVIE':'SERIES'}</div>
    <button class="card-fav \${isFav?'active':''}" onclick="event.stopPropagation();toggleFav('\${c.id}',this)">\${isFav?'♥':'♡'}</button>
    <div class="card-play">▶</div>
    <div class="card-overlay">
      <div class="card-title-ov">\${c.title}</div>
      <div class="card-meta-ov"><span class="card-rating">★ \${c.rating||'—'}</span><span>\${c.year||''}</span></div>
      <div class="card-actions">
        <button class="card-action-btn red" onclick="event.stopPropagation();openDetail('\${c.id}')">▶ Play</button>
        <button class="card-action-btn" onclick="event.stopPropagation();toggleFav('\${c.id}',this.closest('.card').querySelector('.card-fav'))">\${isFav?'♥':'♡'}</button>
      </div>
    </div>
  </div>\`;
}

function renderGenreBar(){
  const allGenres=new Set();
  DB.forEach(c=>{
    if(c.genre)allGenres.add(c.genre);
    if(c.genres)c.genres.forEach(g=>allGenres.add(g));
  });
  const sorted=['All',...Array.from(allGenres).sort()];
  document.getElementById('genreBar').innerHTML=sorted.map(g=>\`<button class="genre-pill \${g===currentGenre?'active':''}" onclick="filterGenre('\${g}',this)">\${g==='All'?'Todos':g}</button>\`).join('');
}

function filterGenre(genre,btn){
  currentGenre=genre;
  document.querySelectorAll('.genre-pill').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  renderHomeSections();
}

function renderHero(){
  const trending=DB_SECTIONS['trending']||DB;
  if(!trending.length)return;
  const c=trending[Math.floor(Math.random()*Math.min(5,trending.length))];
  const bgImg=c.backdrop||c.poster||'';
  document.getElementById('heroContent').innerHTML=\`
    <div class="hero-badge">🎬 \${c.type==='tv'||c.type==='series'?'Serie Destacada':'Película Destacada'}</div>
    <div class="hero-title">\${c.title}</div>
    <div class="hero-meta">
      <span class="rating">★ \${c.rating||'—'}</span>
      <span>\${c.year||''}</span>
      <span>\${c.genre||''}</span>
    </div>
    <div class="hero-btns">
      <button class="btn-watch" onclick="openDetail('\${c.id}')">▶ Ver Ahora</button>
      <button class="btn-info" onclick="openDetail('\${c.id}')">Más Info</button>
    </div>\`;
  const bg=document.querySelector('.hero-bg');
  if(bgImg)bg.innerHTML=\`<img src="\${bgImg}" style="width:100%;height:100%;object-fit:cover;opacity:.35" onerror="this.style.opacity=0"/>\`;
}

function openDetail(id){
  const c=DB.find(x=>String(x.id)===String(id));if(!c)return;
  document.getElementById('detailPoster').innerHTML=c.poster
    ?\`<img src="\${c.poster}" style="width:100%;height:100%;object-fit:cover" onerror="this.outerHTML='<div class=detail-poster-ph>\${c.type==='movie'?'🎬':'📺'}</div>'"/>\`
    :\`<div class="detail-poster-ph">\${c.type==='movie'?'🎬':'📺'}</div>\`;
  document.getElementById('detailHeroBg').innerHTML=c.poster
    ?\`<img src="\${c.poster}" style="width:100%;height:100%;object-fit:cover;opacity:.25" onerror="this.style.opacity=0"/>\`
    :\`<div style="width:100%;height:100%;background:linear-gradient(135deg,#0d0d0d,#1a0000)"></div>\`;
  document.getElementById('detailTitle').textContent=c.title;
  document.getElementById('detailTagline').textContent=c.tagline||'';
  document.getElementById('detailMeta').innerHTML=\`<span class="rating">★ \${c.rating||'—'}</span><span>\${c.year||''}</span><span>\${c.duration||''}</span><span style="background:var(--glass);padding:2px 8px;border-radius:4px;font-size:.7rem">\${c.type==='movie'?'MOVIE':'SERIES'}</span>\`;
  document.getElementById('detailGenres').innerHTML=c.genre?\`<span class="genre-tag">\${c.genre}</span>\`:'';
  document.getElementById('detailDesc').textContent=c.description||c.desc||'';
  const isFav=FAV.includes(c.id);
  document.getElementById('detailBtns').innerHTML=\`
    <button class="btn-watch" onclick="playContent()">▶ Reproducir</button>
    <button class="btn-info" id="favDetailBtn" onclick="toggleFavDetail(\${c.id})">\${isFav?'Guardado':'Favorito'}</button>
    <button class="btn-info" onclick="goHome()">← Volver</button>\`;
  const sources=[];
  if(c.sources&&c.sources.length){c.sources.forEach(s=>sources.push({url:s.url,label:s.label||'Fuente'}));}
  else{
    if(c.src1)sources.push({url:c.src1,label:c.src1label||'Tráiler'});
    if(c.src2)sources.push({url:c.src2,label:c.src2label||'Ver Película'});
    if(c.src3)sources.push({url:c.src3,label:c.src3label||'Fuente 3'});
  }
  if(c.src4)sources.push({url:c.src4,label:c.src4label||'🇪🇸 Español'});
  const pw=document.getElementById('playerWrap');
  const st=document.getElementById('sourceTabs');
  document.getElementById('playerSection').style.display='block';
  if(sources.length){
    loadSource(sources[0].url,pw);
    st.innerHTML=sources.map((s,i)=>\`<button class="source-tab \${i===0?'active':''}" onclick="switchSource('\${s.url}',this,event)">\${s.label}</button>\`).join('');
  }else{
    pw.innerHTML=\`<div class="player-placeholder"><div style="font-size:3.5rem">📽</div><div style="font-size:.85rem">Sin fuentes de video</div></div>\`;
    st.innerHTML='';
  }
  const user=JSON.parse(localStorage.getItem('elfilme_user')||'null');
  const likes=c.likes||0;const likedBy=c.likedBy||[];
  const hasLiked=user&&likedBy.includes(user.username);
  const likeBtn=document.getElementById('likeBtn');
  document.getElementById('likesBar').style.display='flex';
  likeBtn.className='like-btn'+(hasLiked?' liked':'');
  likeBtn.setAttribute('data-id',id);
  document.getElementById('likeBtnText').textContent=hasLiked?'Te gustó':'Me gusta';
  document.getElementById('likeCount').textContent=likes>0?likes+' '+(likes===1?'like':'likes'):'';
  const related=DB.filter(x=>x.id!==id&&(x.genre===c.genre||x.type===c.type)).slice(0,8);
  const rs=document.getElementById('relatedSection');
  if(related.length){rs.style.display='block';document.getElementById('relatedGrid').innerHTML=related.map(r=>cardHTML(r)).join('');}
  else rs.style.display='none';
  showPage('detail');
}

function loadSource(url,wrap){wrap.innerHTML=\`<iframe src="\${url}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="no-referrer"></iframe>\`;}
function switchSource(url,btn,e){e.stopPropagation();document.querySelectorAll('.source-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');loadSource(url,document.getElementById('playerWrap'));}
function playContent(){document.getElementById('playerWrap').scrollIntoView({behavior:'smooth',block:'start'});}

async function toggleLike(){
  const user=JSON.parse(localStorage.getItem('elfilme_user')||'null');
  if(!user){toast('Inicia sesión para dar like',false);return;}
  const btn=document.getElementById('likeBtn');
  const id=btn.getAttribute('data-id');
  const idx=DB.findIndex(x=>String(x.id)===String(id));if(idx===-1)return;
  const c=DB[idx];
  if(!c.likes)c.likes=0;if(!c.likedBy)c.likedBy=[];
  const alreadyLiked=c.likedBy.includes(user.username);
  if(alreadyLiked){c.likes=Math.max(0,c.likes-1);c.likedBy=c.likedBy.filter(u=>u!==user.username);btn.className='like-btn';document.getElementById('likeBtnText').textContent='Me gusta';toast('Like eliminado');}
  else{c.likes+=1;c.likedBy.push(user.username);btn.className='like-btn liked';document.getElementById('likeBtnText').textContent='Te gustó';toast('Guardado');}
  DB[idx]=c;
  document.getElementById('likeCount').textContent=c.likes>0?c.likes+' '+(c.likes===1?'like':'likes'):'';
  await save();
}

function toggleFav(id,btn){
  if(FAV.includes(id)){FAV=FAV.filter(f=>f!==id);btn.textContent='♡';btn.classList.remove('active');toast('Eliminado de favoritos');}
  else{FAV.push(id);btn.textContent='♥';btn.classList.add('active');toast('Guardado en favoritos');}
  save();updateFavCount();
}
function toggleFavDetail(id){
  const btn=document.getElementById('favDetailBtn');
  if(FAV.includes(id)){FAV=FAV.filter(f=>f!==id);btn.innerHTML='Favorito';}
  else{FAV.push(id);btn.innerHTML='Guardado';}
  save();updateFavCount();
}
function updateFavCount(){
  ['favCount','favCountDesk','favCountMenu'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=FAV.length;});
}
function showFavorites(){
  const favs=DB.filter(c=>FAV.includes(c.id));
  document.getElementById('favsGrid').innerHTML=favs.map(c=>cardHTML(c)).join('');
  document.getElementById('favsEmpty').style.display=favs.length?'none':'block';
  showPage('favorites');
}

function liveSearch(q){clearTimeout(searchTimeout);if(!q.trim())return;searchTimeout=setTimeout(()=>doSearch(q),350);}
function doSearch(q){
  if(!q.trim())return;
  const results=DB.filter(c=>c.title.toLowerCase().includes(q.toLowerCase())||(c.genre||'').toLowerCase().includes(q.toLowerCase())||(c.desc||'').toLowerCase().includes(q.toLowerCase()));
  document.getElementById('searchQueryDisplay').textContent=\`"\${q}"\`;
  document.getElementById('searchCountDisplay').textContent=\`\${results.length} resultado\${results.length!==1?'s':''}\`;
  document.getElementById('searchGrid').innerHTML=results.map(c=>cardHTML(c)).join('');
  document.getElementById('searchEmpty').style.display=results.length?'none':'block';
  showPage('search');
}

function openAdminGate(){document.getElementById('pwdModal').classList.add('open');document.getElementById('pwdInput').value='';document.getElementById('pwdError').style.display='none';setTimeout(()=>document.getElementById('pwdInput').focus(),100);}
function closePwdModal(){document.getElementById('pwdModal').classList.remove('open');}
function checkPwd(){
  const val=document.getElementById('pwdInput').value;
  if(val===SETTINGS.pwd||val==='admin123'){closePwdModal();openAdmin();}
  else document.getElementById('pwdError').style.display='block';
}

function openAdmin(){
  document.getElementById('adminModal').classList.add('open');document.body.style.overflow='hidden';
  renderAdminList();document.getElementById('contentCount').textContent=DB.length;
  document.getElementById('s-sitename').value=SETTINGS.sitename||'';
  document.getElementById('s-featured').value=SETTINGS.featured||'';
}
function closeAdmin(){document.getElementById('adminModal').classList.remove('open');document.body.style.overflow='';renderHome();}
document.getElementById('adminModal').addEventListener('click',e=>{if(e.target===document.getElementById('adminModal'))closeAdmin();});

function switchAdminTab(id,btn){
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');
  document.querySelectorAll('.modal-tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById('admin-'+id).classList.add('active');
  if(id==='manage')renderAdminList();
}

async function saveContent(){
  const title=document.getElementById('f-title').value.trim();
  if(!title){toast('¡El título es obligatorio!',false);return;}
  const editId=document.getElementById('f-editId').value;
  const content={id:editId?parseInt(editId):Date.now(),title,type:document.getElementById('f-type').value,year:document.getElementById('f-year').value,rating:document.getElementById('f-rating').value,genre:document.getElementById('f-genre').value,duration:document.getElementById('f-duration').value,poster:document.getElementById('f-poster').value.trim(),desc:document.getElementById('f-desc').value.trim(),src1:document.getElementById('f-src1').value.trim(),src1label:document.getElementById('f-src1label').value.trim(),src2:document.getElementById('f-src2').value.trim(),src2label:document.getElementById('f-src2label').value.trim(),src3:document.getElementById('f-src3').value.trim(),src3label:document.getElementById('f-src3label').value.trim(),src4:document.getElementById('f-src4').value.trim(),src4label:document.getElementById('f-src4label').value.trim()};
  if(editId){const idx=DB.findIndex(c=>c.id===parseInt(editId));if(idx!==-1)DB[idx]=content;}
  else DB.unshift(content);
  await save();toast('✓ Guardado!');clearForm();
  document.getElementById('contentCount').textContent=DB.length;renderAdminList();
}

function clearForm(){
  ['f-title','f-year','f-rating','f-duration','f-poster','f-desc','f-src1','f-src1label','f-src2','f-src2label','f-src3','f-src3label','f-src4','f-src4label','f-editId'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('f-type').value='movie';document.getElementById('f-genre').value='Acción';
}

function renderAdminList(){
  const list=document.getElementById('adminList');const empty=document.getElementById('adminEmpty');
  if(!DB.length){list.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  list.innerHTML=DB.map(c=>\`<div class="admin-item">
    <div class="admin-item-poster">\${c.poster?\`<img src="\${c.poster}" style="width:100%;height:100%;border-radius:4px;object-fit:cover" onerror="this.parentElement.textContent='\${c.type==='movie'?'🎬':'📺'}'"/>\`:(c.type==='movie'?'🎬':'📺')}</div>
    <div class="admin-item-info"><div class="admin-item-title">\${c.title}</div><div class="admin-item-meta">\${c.type.toUpperCase()} · \${c.year||'—'}</div></div>
    <div class="admin-item-actions"><button class="btn-edit" onclick="editContent(\${c.id})">Editar</button><button class="btn-del" onclick="deleteContent(\${c.id})">Del</button></div>
  </div>\`).join('');
}

function editContent(id){
  const c=DB.find(x=>x.id===id);if(!c)return;
  document.getElementById('f-title').value=c.title||'';document.getElementById('f-type').value=c.type||'movie';document.getElementById('f-year').value=c.year||'';document.getElementById('f-rating').value=c.rating||'';document.getElementById('f-genre').value=c.genre||'Acción';document.getElementById('f-duration').value=c.duration||'';document.getElementById('f-poster').value=c.poster||'';document.getElementById('f-desc').value=c.desc||'';document.getElementById('f-src1').value=c.src1||'';document.getElementById('f-src1label').value=c.src1label||'';document.getElementById('f-src2').value=c.src2||'';document.getElementById('f-src2label').value=c.src2label||'';document.getElementById('f-src3').value=c.src3||'';document.getElementById('f-src3label').value=c.src3label||'';document.getElementById('f-src4').value=c.src4||'';document.getElementById('f-src4label').value=c.src4label||'';document.getElementById('f-editId').value=c.id;
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.modal-tab-content').forEach(t=>t.classList.remove('active'));document.querySelector('.modal-tab').classList.add('active');document.getElementById('admin-add').classList.add('active');toast('Editando: '+c.title);
}

async function deleteContent(id){
  if(!confirm('¿Borrar este contenido?'))return;
  DB=DB.filter(c=>c.id!==id);FAV=FAV.filter(f=>f!==id);
  await save();renderAdminList();document.getElementById('contentCount').textContent=DB.length;toast('Borrado',false);
}

async function clearAllContent(){
  if(!confirm('¿Borrar TODO el contenido?'))return;
  DB=[];FAV=[];await save();renderAdminList();document.getElementById('contentCount').textContent=0;toast('Todo borrado',false);
}

async function saveSettings(){
  SETTINGS.sitename=document.getElementById('s-sitename').value||'Synapt Cinema';
  SETTINGS.featured=document.getElementById('s-featured').value;
  const newPwd=document.getElementById('s-newpwd').value;
  if(newPwd)SETTINGS.pwd=newPwd;
  await save();toast('✓ Ajustes guardados!');
}

function openInfoModal(type){document.getElementById('modal-'+type).classList.add('open');document.body.style.overflow='hidden';}
function closeInfoModal(id){document.getElementById('modal-'+id).classList.remove('open');document.body.style.overflow='';}

initDB();
</script>
</body>
</html>`;
const ESTRENOS_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>ElFilme - Cartelera VIP</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&family=Bebas+Neue&display=swap" rel="stylesheet"/>
<style>
:root {
  --bg:#0a0a0a; --accent:#e50914; --text:#fff; --muted:#888;
  --radius:8px;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif;overflow-x:hidden;}

/* HEADER */
header{padding:1.2rem 1.5rem; display:flex; align-items:center; position:absolute; top:0; z-index:100;}
.logo img{height:50px; border-radius:var(--radius); box-shadow: 0 4px 20px rgba(0,0,0,0.8);}

/* HERO BANNER */
.hero{height:55vh; position:relative; display:flex; align-items:flex-end; padding:3rem 1.5rem; background-size:cover; background-position:center; transition: 0.5s;}
.hero::before{content:''; position:absolute; inset:0; background:linear-gradient(0deg, var(--bg) 10%, transparent 100%), linear-gradient(90deg, var(--bg) 0%, transparent 70%);}
.hero-content{position:relative; z-index:2; max-width:800px;}
.hero-badge{color:var(--accent); font-family:'Bebas Neue'; letter-spacing:4px; font-size:1.1rem;}
.hero-title{font-size:2.8rem; font-family:'Bebas Neue'; line-height:1; margin:5px 0;}

/* SECCIONES DE CARRUSEL */
.section{margin-top:2rem; padding-left:1.5rem;}
.section-title{font-family:'Bebas Neue'; font-size:1.6rem; letter-spacing:2px; margin-bottom:1rem; color:#fff; display:flex; align-items:center; gap:10px;}
.section-title::after{content:''; height:1px; background:var(--accent); flex:1; opacity:0.4;}

.carrusel-container{
  display:flex;
  gap:12px;
  overflow-x:auto;
  padding-bottom:1.5rem;
  scroll-behavior:smooth;
  -webkit-overflow-scrolling: touch;
}
.carrusel-container::-webkit-scrollbar{display:none;}

/* TARJETAS */
.movie-card{
  flex:0 0 150px;
  position:relative;
  transition:0.3s cubic-bezier(.25,.46,.45,.94);
  cursor:pointer;
}
.movie-card:active{transform:scale(0.95);}
.movie-card img{width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:var(--radius); border:1px solid rgba(255,255,255,0.05);}
.badge{
  position:absolute; top:8px; left:8px; 
  background:var(--accent); color:white; 
  font-size:0.6rem; font-weight:800; 
  padding:2px 8px; border-radius:3px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

/* PLAYER MODAL */
.modal{position:fixed; inset:0; background:rgba(0,0,0,0.98); z-index:1000; display:none; align-items:center; justify-content:center;}
.modal-content{width:100%; max-width:1000px; aspect-ratio:16/9; position:relative;}
.close-btn{position:absolute; top:-40px; right:15px; color:white; cursor:pointer; font-family:'Bebas Neue'; font-size:1.2rem;}
iframe{width:100%; height:100%; border:none;}

@media(max-width:600px){
  .hero{height:45vh;}
  .hero-title{font-size:2.2rem;}
  .movie-card{flex:0 0 135px;}
}
</style>
</head>
<body>

<header>
  <a href="https://elfilme.com" class="logo">
    <img src="https://elfilme.com/copilot_image_1772812453252.jpeg" alt="Synapt Logo"/>
  </a>
</header>

<div class="hero" id="hero-banner">
  <div class="hero-content">
    <div class="hero-badge">NOW PLAYING IN THEATERS</div>
    <h1 class="hero-title" id="hero-name">CARGANDO...</h1>
  </div>
</div>

<div id="render-categorias">
  </div>

<div class="modal" id="player">
  <div class="modal-content">
    <div class="close-btn" onclick="closeVideo()">CERRAR [X]</div>
    <iframe id="video-iframe" src="" allowfullscreen></iframe>
  </div>
</div>

<script>
const BIN_ID = '69ce041936566621a870294e';
const MASTER_KEY = '$2a$10$2FU4DfoZscB5BrItbrVx3ezRVN5ynuE1zH1Zy3X6IW5NP8p3pigwe';

async function cargarContenido() {
  const res = await fetch(\`https://api.jsonbin.io/v3/b/\${BIN_ID}/latest\`, {
    headers: { 'X-Master-Key': MASTER_KEY }
  });
  const data = await res.json();
  const pelis = data.record;

  // Actualizar Banner
  if(pelis.length > 0) {
    document.getElementById('hero-banner').style.backgroundImage = \`url(\${pelis[0].poster})\`;
    document.getElementById('hero-name').innerText = pelis[0].title;
  }

  // Obtener géneros únicos del JSON actualizado
  const categorias = [...new Set(pelis.map(p => p.category))];
  const container = document.getElementById('render-categorias');

  container.innerHTML = categorias.map(cat => \`
    <div class="section">
      <h2 class="section-title">\${cat}</h2>
      <div class="carrusel-container">
        \${pelis.filter(p => p.category === cat).map(p => \`
          <div class="movie-card" onclick="playMovie('\${p.url_stream}')">
            <div class="badge">ESTRENO</div>
            <img src="\${p.poster}" alt="\${p.title}" loading="lazy">
          </div>
        \`).join('')}
      </div>
    </div>
  \`).join('');
}

function playMovie(url) {
  document.getElementById('video-iframe').src = url;
  document.getElementById('player').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeVideo() {
  document.getElementById('video-iframe').src = '';
  document.getElementById('player').style.display = 'none';
  document.body.style.overflow = 'auto';
}

document.addEventListener('DOMContentLoaded', cargarContenido);
</script>
</body>
</html>
`;
const NOTICIERO_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NOTICIERO — ElFilme.com</title>
<link rel="icon" href="https://elfilme.com/copilot_image_1772812453252.jpeg">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,700;1,400&display=swap" rel="stylesheet">
<style>
  :root {
    --red: #E8292A;
    --red-dark: #b81e1f;
    --gold: #c9a84c;
    --bg: #0a0a0a;
    --bg2: #111111;
    --bg3: #1a1a1a;
    --border: #252525;
    --text: #e8e8e8;
    --muted: #888;
    --white: #ffffff;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'DM Sans', sans-serif;
    min-height: 100vh;
  }

  /* ── HEADER ── */
  .header {
    background: rgba(10,10,10,0.97);
    border-bottom: 1px solid var(--border);
    padding: 0 24px;
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(16px);
  }
  .header-inner {
    max-width: 1280px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 68px;
  }
  .logo-img {
    height: 44px;
    width: auto;
    object-fit: contain;
    display: block;
  }
  .logo {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    color: var(--white);
    letter-spacing: 3px;
  }
  .logo span { color: var(--red); }
  .live-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2px;
    color: var(--muted);
    text-transform: uppercase;
  }
  .live-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--red);
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }

  /* ── TICKER ── */
  .ticker-wrap {
    background: var(--red);
    overflow: hidden;
    white-space: nowrap;
  }
  .ticker-label {
    display: inline-block;
    background: #000;
    color: var(--red);
    font-family: 'Bebas Neue', sans-serif;
    font-size: 13px;
    letter-spacing: 2px;
    padding: 6px 16px;
    vertical-align: middle;
  }
  .ticker-track {
    display: inline-block;
    animation: ticker 40s linear infinite;
    padding: 6px 0;
  }
  .ticker-item {
    display: inline-block;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.5px;
    padding: 0 40px;
    color: #fff;
  }
  @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }

  /* ── MAIN LAYOUT ── */
  .container {
    max-width: 1280px;
    margin: 0 auto;
    padding: 40px 24px;
  }

  /* ── SECTION HEADER ── */
  .section-head {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 28px;
  }
  .section-label {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 22px;
    letter-spacing: 3px;
    color: var(--white);
  }
  .section-line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .section-count {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  /* ── HERO MOVIE (primera película) ── */
  .hero-movie {
    position: relative;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 48px;
    min-height: 520px;
    display: flex;
    align-items: flex-end;
    cursor: pointer;
    background: var(--bg3);
  }
  .hero-movie:hover .hero-img { transform: scale(1.03); }
  .hero-img {
    position: absolute;
    inset: 0;
    width: 100%; height: 100%;
    object-fit: cover;
    transition: transform 0.6s ease;
  }
  .hero-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.1) 100%);
  }
  .hero-content {
    position: relative;
    padding: 40px;
    z-index: 2;
    width: 100%;
  }
  .hero-badge {
    display: inline-block;
    background: var(--red);
    font-family: 'Bebas Neue', sans-serif;
    font-size: 11px;
    letter-spacing: 3px;
    padding: 4px 12px;
    margin-bottom: 16px;
    color: #fff;
  }
  .hero-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: clamp(36px, 6vw, 72px);
    letter-spacing: 4px;
    color: var(--white);
    line-height: 0.95;
    margin-bottom: 8px;
    text-shadow: 0 4px 24px rgba(0,0,0,0.8);
  }
  .hero-tagline {
    font-family: 'Playfair Display', serif;
    font-style: italic;
    font-size: 16px;
    color: var(--gold);
    margin-bottom: 16px;
  }
  .hero-meta {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .meta-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.5px;
  }
  .meta-chip strong { color: var(--text); }
  .rating-star { color: var(--gold); }
  .hero-overview {
    font-size: 14px;
    line-height: 1.7;
    color: #bbb;
    max-width: 680px;
    margin-bottom: 24px;
  }
  .hero-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 24px;
    border-radius: 2px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    text-decoration: none;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }
  .btn-red { background: var(--red); color: #fff; }
  .btn-red:hover { background: var(--red-dark); }
  .btn-outline { background: transparent; color: var(--text); border: 1px solid var(--border); }
  .btn-outline:hover { border-color: var(--text); }
  .btn-gold { background: var(--gold); color: #000; font-weight: 700; }

  /* ── GRID DE PELÍCULAS ── */
  .movies-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 20px;
    margin-bottom: 48px;
  }
  .movie-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }
  .movie-card:hover {
    border-color: var(--red);
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(232,41,42,0.15);
  }
  .card-poster {
    width: 100%;
    aspect-ratio: 2/3;
    object-fit: cover;
    display: block;
    background: var(--bg3);
  }
  .card-poster-placeholder {
    width: 100%;
    aspect-ratio: 2/3;
    background: var(--bg3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 48px;
  }
  .card-rating-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(0,0,0,0.85);
    border: 1px solid var(--gold);
    color: var(--gold);
    font-weight: 700;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 2px;
  }
  .card-body {
    padding: 16px;
  }
  .card-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 16px;
    letter-spacing: 1px;
    color: var(--white);
    margin-bottom: 4px;
    line-height: 1.2;
  }
  .card-genres {
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  }
  .card-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--muted);
  }
  .card-year { font-weight: 600; color: var(--text); }
  .card-actions {
    display: flex;
    gap: 6px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }
  .card-btn {
    flex: 1;
    text-align: center;
    padding: 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    text-decoration: none;
    border-radius: 2px;
    transition: all 0.15s;
  }
  .card-btn-trailer {
    background: var(--red);
    color: #fff;
  }
  .card-btn-bts {
    background: var(--bg3);
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .card-btn-bts:hover { color: var(--text); border-color: var(--text); }

  /* ── MODAL PELÍCULA ── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.9);
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 20px;
    overflow-y: auto;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
  }
  .modal-overlay.open {
    opacity: 1;
    pointer-events: all;
  }
  .modal {
    background: var(--bg2);
    border: 1px solid var(--border);
    width: 100%;
    max-width: 900px;
    border-radius: 4px;
    overflow: hidden;
    transform: translateY(30px);
    transition: transform 0.3s;
    margin: auto;
  }
  .modal-overlay.open .modal { transform: translateY(0); }
  .modal-backdrop {
    width: 100%;
    height: 280px;
    object-fit: cover;
    display: block;
    background: var(--bg3);
  }
  .modal-body { padding: 32px; }
  .modal-close {
    position: absolute;
    top: 28px;
    right: 28px;
    width: 36px; height: 36px;
    background: rgba(0,0,0,0.7);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 50%;
    cursor: pointer;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 40px;
    letter-spacing: 3px;
    margin-bottom: 6px;
  }
  .modal-tagline {
    font-family: 'Playfair Display', serif;
    font-style: italic;
    color: var(--gold);
    margin-bottom: 20px;
    font-size: 15px;
  }
  .modal-stats {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }
  .stat { text-align: center; }
  .stat-val {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 24px;
    color: var(--white);
    letter-spacing: 1px;
  }
  .stat-val.gold { color: var(--gold); }
  .stat-label { font-size: 10px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; }
  .modal-overview {
    font-size: 15px;
    line-height: 1.8;
    color: #ccc;
    margin-bottom: 24px;
  }
  .modal-section-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 14px;
    letter-spacing: 3px;
    color: var(--muted);
    margin-bottom: 12px;
    text-transform: uppercase;
  }
  .cast-grid {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 8px;
    margin-bottom: 24px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .cast-card {
    flex-shrink: 0;
    text-align: center;
    width: 80px;
  }
  .cast-photo {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg3);
    border: 2px solid var(--border);
    margin: 0 auto 8px;
    display: block;
  }
  .cast-name { font-size: 11px; font-weight: 600; color: var(--text); line-height: 1.3; }
  .cast-char { font-size: 10px; color: var(--muted); }
  .videos-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 24px;
  }
  .video-link {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 2px;
    text-decoration: none;
    color: var(--text);
    transition: border-color 0.2s;
  }
  .video-link:hover { border-color: var(--red); }
  .video-icon {
    width: 36px; height: 36px;
    background: var(--red);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 14px;
  }
  .video-name { font-size: 13px; font-weight: 500; }
  .video-type { font-size: 11px; color: var(--muted); }
  .reviews-list { margin-bottom: 24px; }
  .review-card {
    padding: 16px;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 2px;
    margin-bottom: 10px;
  }
  .review-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .review-author { font-weight: 600; font-size: 13px; }
  .review-rating { color: var(--gold); font-weight: 700; font-size: 13px; }
  .review-text { font-size: 13px; line-height: 1.7; color: #aaa; }
  .backdrops-scroll {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    margin-bottom: 24px;
    scrollbar-width: thin;
  }
  .backdrop-thumb {
    flex-shrink: 0;
    width: 200px;
    height: 112px;
    object-fit: cover;
    border-radius: 2px;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: border-color 0.2s;
  }
  .backdrop-thumb:hover { border-color: var(--red); }

  /* ── NOTICIAS ── */
  .news-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
    margin-bottom: 48px;
  }
  .news-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    transition: all 0.2s;
    text-decoration: none;
    color: var(--text);
    display: flex;
    flex-direction: column;
  }
  .news-card:hover {
    border-color: var(--red);
    transform: translateY(-2px);
  }
  .news-thumb {
    width: 100%;
    height: 180px;
    object-fit: cover;
    background: var(--bg3);
    display: block;
  }
  .news-thumb-placeholder {
    width: 100%;
    height: 180px;
    background: var(--bg3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 40px;
  }
  .news-body { padding: 20px; flex: 1; }
  .news-source {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--red);
    margin-bottom: 8px;
  }
  .news-title {
    font-family: 'Playfair Display', serif;
    font-size: 16px;
    line-height: 1.4;
    margin-bottom: 10px;
    color: var(--white);
  }
  .news-desc {
    font-size: 13px;
    color: var(--muted);
    line-height: 1.6;
  }
  .news-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .news-date { font-size: 11px; color: var(--muted); }
  .news-arrow { color: var(--red); font-size: 14px; }

  /* ── ESTADO ── */
  .loading-state {
    text-align: center;
    padding: 80px 20px;
    color: var(--muted);
  }
  .loader {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--red);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 20px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── FOOTER ── */
  .footer {
    border-top: 1px solid var(--border);
    padding: 24px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 1px;
  }
  .footer a { color: var(--red); text-decoration: none; }
  .updated-at {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 1px;
  }

  @media (max-width: 640px) {
    .hero-content { padding: 24px; }
    .hero-title { font-size: 36px; }
    .hero-actions { flex-direction: column; }
    .movies-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .news-grid { grid-template-columns: 1fr; }
    .modal { margin: 0; border-radius: 0; }
    .modal-body { padding: 20px; }
  }
</style>
</head>
<body>

<!-- HEADER -->
<header class="header">
  <div class="header-inner">
    <a href="https://elfilme.com" target="_blank" style="display:flex;align-items:center">
      <img class="logo-img" src="https://elfilme.com/copilot_image_1772812453252.jpeg" alt="ElFilme.com" onerror="this.outerHTML='<div class=logo>El<span>Filme</span>.com</div>'">
    </a>
    <div class="live-badge">
      <div class="live-dot"></div>
      <span>Actualización en vivo</span>
    </div>
  </div>
</header>

<!-- TICKER -->
<div class="ticker-wrap">
  <span class="ticker-label">CINE HOY</span>
  <div class="ticker-track" id="ticker">
    <span class="ticker-item">Cargando noticias...</span>
  </div>
</div>

<!-- MAIN -->
<div class="container">

  <!-- HERO -->
  <div id="hero-section"></div>

  <!-- TRENDING -->
  <div class="section-head">
    <div class="section-label">TRENDING ESTA SEMANA</div>
    <div class="section-line"></div>
    <div class="section-count" id="movie-count">—</div>
  </div>
  <div id="movies-grid" class="movies-grid">
    <div class="loading-state" style="grid-column:1/-1">
      <div class="loader"></div>
      <div>Cargando películas...</div>
    </div>
  </div>

  <!-- NOTICIAS -->
  <div class="section-head">
    <div class="section-label">NOTICIAS DE CINE</div>
    <div class="section-line"></div>
    <div class="section-count" id="news-count">—</div>
  </div>
  <div id="news-grid" class="news-grid">
    <div class="loading-state" style="grid-column:1/-1">
      <div class="loader"></div>
      <div>Cargando noticias...</div>
    </div>
  </div>

  <!-- NETFLIX -->
  <div class="section-head">
    <div class="section-label">QUÉ VER EN NETFLIX</div>
    <div class="section-line"></div>
    <div class="section-count" id="netflix-count">—</div>
  </div>
  <div id="netflix-grid" class="movies-grid">
    <div class="loading-state" style="grid-column:1/-1">
      <div class="loader"></div>
      <div>Cargando Netflix Top 10...</div>
    </div>
  </div>

  <div class="updated-at" id="updated-at"></div>
</div>

<!-- MODAL -->
<div class="modal-overlay" id="modal-overlay" onclick="closeModal(event)">
  <div class="modal" id="modal-content"></div>
</div>

<!-- FOOTER -->
<footer class="footer">
  <p><img src="https://elfilme.com/copilot_image_1772812453252.jpeg" alt="ElFilme.com" style="height:28px;vertical-align:middle;margin-right:10px"> · <a href="https://synapt.live">SYNAPT.LIVE</a> · Datos: TMDB + Google News</p>
</footer>

<script>
const JSONBIN_ID = "69cc735aaaba882197b21a03";
const JSONBIN_NETFLIX_ID = "69cc9029aaba882197b28db6";
const JSONBIN_KEY = "$2a$10$2FU4DfoZscB5BrItbrVx3ezRVN5ynuE1zH1Zy3X6IW5NP8p3pigwe";

let DATA = null;

async function loadData() {
  try {
    const [mainRes, netflixRes] = await Promise.all([
      fetch(\`https://api.jsonbin.io/v3/b/\${JSONBIN_ID}/latest\`, {
        headers: { "X-Master-Key": JSONBIN_KEY }
      }),
      fetch(\`https://api.jsonbin.io/v3/b/\${JSONBIN_NETFLIX_ID}/latest\`, {
        headers: { "X-Master-Key": JSONBIN_KEY }
      })
    ]);
    const mainJson = await mainRes.json();
    const netflixJson = await netflixRes.json();
    DATA = mainJson.record;
    render(DATA);
    renderNetflix(netflixJson.record?.netflix || []);
  } catch (err) {
    document.getElementById("movies-grid").innerHTML =
      \`<div class="loading-state" style="grid-column:1/-1">⚠️ Error cargando datos.</div>\`;
    console.error(err);
  }
}

function render(data) {
  renderTicker(data);
  renderHero(data.movies?.[0]);
  renderMovies(data.movies?.slice(1) || []);
  renderNews(data.news || []);
  if (data.updatedAt) {
    const d = new Date(data.updatedAt);
    document.getElementById("updated-at").textContent = 
      \`Última actualización: \${d.toLocaleDateString("es-MX", {weekday:"long", year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit"})}\`;
  }
}

function renderTicker(data) {
  const items = [];
  (data.movies || []).forEach(m => {
    items.push(\`🎬 \${m.title} — Rating \${m.rating}/10\`);
    if (m.trailer) items.push(\`▶ Trailer disponible: \${m.title}\`);
  });
  (data.news || []).slice(0, 5).forEach(n => {
    if (n.title) items.push(\`📰 \${n.title}\`);
  });

  const doubled = [...items, ...items];
  document.getElementById("ticker").innerHTML = 
    doubled.map(i => \`<span class="ticker-item">\${i} &nbsp;&nbsp;·&nbsp;&nbsp;</span>\`).join("");
}

function renderHero(movie) {
  if (!movie) return;
  const heroEl = document.getElementById("hero-section");
  const genres = (movie.genres || []).slice(0, 3).join(" · ");
  const cast = (movie.cast || []).slice(0, 3).map(a => a.name).join(", ");

  heroEl.innerHTML = \`
    <div class="hero-movie" onclick="openModal(0)">
      \${movie.backdrop
        ? \`<img class="hero-img" src="\${movie.backdrop}" alt="\${movie.title}" onerror="this.style.display='none'">\`
        : ""}
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <div class="hero-badge">🔥 #1 TRENDING</div>
        <div class="hero-title">\${movie.title}</div>
        \${movie.tagline ? \`<div class="hero-tagline">"\${movie.tagline}"</div>\` : ""}
        <div class="hero-meta">
          \${movie.rating ? \`<div class="meta-chip"><span class="rating-star">★</span><strong>\${movie.rating}</strong>/10</div>\` : ""}
          \${movie.releaseDate ? \`<div class="meta-chip">📅 <strong>\${movie.releaseDate?.substring(0,4)}</strong></div>\` : ""}
          \${movie.runtime ? \`<div class="meta-chip">⏱ <strong>\${movie.runtime} min</strong></div>\` : ""}
          \${genres ? \`<div class="meta-chip">🎭 <strong>\${genres}</strong></div>\` : ""}
          \${movie.director ? \`<div class="meta-chip">🎬 <strong>\${movie.director.name}</strong></div>\` : ""}
        </div>
        <div class="hero-overview">\${(movie.overview || "").substring(0, 280)}\${movie.overview?.length > 280 ? "..." : ""}</div>
        <div class="hero-actions">
          \${movie.trailer ? \`<a href="\${movie.trailer.url}" target="_blank" class="btn btn-red" onclick="event.stopPropagation()">▶ VER TRAILER</a>\` : ""}
          <button class="btn btn-outline" onclick="openModal(0); event.stopPropagation()">+ INFO COMPLETA</button>
          \${movie.behindTheScenes?.[0] ? \`<a href="\${movie.behindTheScenes[0].url}" target="_blank" class="btn btn-outline" onclick="event.stopPropagation()">🎥 BEHIND THE SCENES</a>\` : ""}
        </div>
      </div>
    </div>
  \`;
}

function renderMovies(movies) {
  document.getElementById("movie-count").textContent = \`\${movies.length + 1} PELÍCULAS\`;
  if (!movies.length) {
    document.getElementById("movies-grid").innerHTML = 
      \`<div class="loading-state" style="grid-column:1/-1">Sin películas disponibles</div>\`;
    return;
  }

  document.getElementById("movies-grid").innerHTML = movies.map((m, i) => \`
    <div class="movie-card" onclick="openModal(\${i + 1})">
      \${m.rating ? \`<div class="card-rating-badge">★ \${m.rating}</div>\` : ""}
      \${m.poster
        ? \`<img class="card-poster" src="\${m.poster}" alt="\${m.title}" onerror="this.style.display='none'">\`
        : \`<div class="card-poster-placeholder">🎬</div>\`}
      <div class="card-body">
        <div class="card-title">\${m.title}</div>
        <div class="card-genres">\${(m.genres || []).slice(0, 2).join(" · ")}</div>
        <div class="card-meta">
          <span class="card-year">\${m.releaseDate?.substring(0,4) || "—"}</span>
          \${m.runtime ? \`<span>\${m.runtime} min</span>\` : ""}
        </div>
      </div>
      <div class="card-actions">
        \${m.trailer
          ? \`<a href="\${m.trailer.url}" target="_blank" class="card-btn card-btn-trailer" onclick="event.stopPropagation()">▶ Trailer</a>\`
          : \`<span class="card-btn card-btn-bts" style="opacity:0.4">Sin trailer</span>\`}
        \${m.behindTheScenes?.[0]
          ? \`<a href="\${m.behindTheScenes[0].url}" target="_blank" class="card-btn card-btn-bts" onclick="event.stopPropagation()">🎥 BTS</a>\`
          : ""}
      </div>
    </div>
  \`).join("");
}

function renderNetflix(netflix) {
  const valid = (netflix || []).filter(n => n.title);
  document.getElementById("netflix-count").textContent = \`TOP \${valid.length}\`;
  if (!valid.length) {
    document.getElementById("netflix-grid").innerHTML =
      \`<div class="loading-state" style="grid-column:1/-1">Sin datos de Netflix disponibles</div>\`;
    return;
  }
  document.getElementById("netflix-grid").innerHTML = valid.map((n, i) => \`
    <div class="movie-card" style="cursor:default">
      <div style="position:absolute;top:10px;left:10px;background:#E50914;color:#fff;font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;padding:2px 10px;border-radius:2px;z-index:2">#\${n.rank || i+1}</div>
      \${n.image
        ? \`<img class="card-poster" src="\${n.image}" alt="\${n.title}" onerror="this.outerHTML='<div class=card-poster-placeholder>🎬</div>'">\`
        : \`<div class="card-poster-placeholder">🎬</div>\`}
      <div class="card-body">
        <div class="card-title">\${n.title}</div>
        \${n.views ? \`<div class="card-genres" style="color:#E50914">\${n.views}</div>\` : ""}
      </div>
      \${n.url ? \`<div class="card-actions">
        <a href="\${n.url}" target="_blank" class="card-btn card-btn-trailer" style="background:#E50914">▶ Ver en Netflix</a>
      </div>\` : ""}
    </div>
  \`).join("");
}

function normalizeNews(n) {
  // Apify puede devolver campos con distintos nombres segun el scraper
  return {
    title: n.title || n.headline || n.name || "",
    description: n.description || n.snippet || n.summary || n.content || n.body || "",
    url: n.url || n.link || n.href || "#",
    image: n.image || n.thumbnail || n.imageUrl || n.img || n.picture || null,
    source: (typeof n.source === "object" ? n.source?.name : n.source) || n.publisher || n.domain || n.siteName || "Google News",
    publishedAt: n.publishedAt || n.date || n.pubDate || n.publishDate || n.datePublished || null
  };
}

function renderNews(rawNews) {
  const news = (rawNews || []).map(normalizeNews).filter(n => n.title);
  document.getElementById("news-count").textContent = \`\${news.length} NOTICIAS\`;

  if (!news.length) {
    document.getElementById("news-grid").innerHTML =
      \`<div class="loading-state" style="grid-column:1/-1">Sin noticias disponibles aún</div>\`;
    return;
  }

  document.getElementById("news-grid").innerHTML = news.map(n => \`
    <a href="\${n.url}" target="_blank" class="news-card">
      \${n.image
        ? \`<img class="news-thumb" src="\${n.image}" alt="\${n.title}" onerror="this.outerHTML='<div class=news-thumb-placeholder>📰</div>'">\`
        : \`<div class="news-thumb-placeholder">📰</div>\`}
      <div class="news-body">
        <div class="news-source">\${n.source}</div>
        <div class="news-title">\${n.title}</div>
        \${n.description ? \`<div class="news-desc">\${n.description.substring(0, 160)}\${n.description.length > 160 ? "..." : ""}</div>\` : ""}
      </div>
      <div class="news-footer">
        <span class="news-date">\${n.publishedAt ? new Date(n.publishedAt).toLocaleDateString("es-MX", {day:"numeric", month:"short", year:"numeric"}) : ""}</span>
        <span class="news-arrow">→</span>
      </div>
    </a>
  \`).join("");
}

function openModal(index) {
  if (!DATA?.movies?.[index]) return;
  const m = DATA.movies[index];
  const modal = document.getElementById("modal-content");

  const statsHtml = [
    m.rating ? \`<div class="stat"><div class="stat-val gold">★ \${m.rating}</div><div class="stat-label">Rating TMDB</div></div>\` : "",
    m.votes ? \`<div class="stat"><div class="stat-val">\${(m.votes/1000).toFixed(1)}K</div><div class="stat-label">Votos</div></div>\` : "",
    m.runtime ? \`<div class="stat"><div class="stat-val">\${m.runtime}'</div><div class="stat-label">Duración</div></div>\` : "",
    m.releaseDate ? \`<div class="stat"><div class="stat-val">\${m.releaseDate.substring(0,4)}</div><div class="stat-label">Año</div></div>\` : "",
    m.revenue > 0 ? \`<div class="stat"><div class="stat-val">$\${(m.revenue/1e6).toFixed(0)}M</div><div class="stat-label">Taquilla</div></div>\` : ""
  ].filter(Boolean).join("");

  const castHtml = (m.cast || []).map(a => \`
    <div class="cast-card">
      \${a.photo
        ? \`<img class="cast-photo" src="\${a.photo}" alt="\${a.name}" onerror="this.outerHTML='<div class=cast-photo style=background:var(--bg3)></div>'">\`
        : \`<div class="cast-photo" style="background:var(--bg3)"></div>\`}
      <div class="cast-name">\${a.name}</div>
      <div class="cast-char">\${a.character || ""}</div>
    </div>
  \`).join("");

  const videosHtml = [
    m.trailer ? \`<a href="\${m.trailer.url}" target="_blank" class="video-link">
      <div class="video-icon">▶</div>
      <div><div class="video-name">\${m.trailer.name}</div><div class="video-type">Trailer Oficial</div></div>
    </a>\` : "",
    ...(m.behindTheScenes || []).map(v => \`<a href="\${v.url}" target="_blank" class="video-link">
      <div class="video-icon" style="background:var(--bg3);border:1px solid var(--border);color:var(--muted)">🎥</div>
      <div><div class="video-name">\${v.name}</div><div class="video-type">Behind the Scenes</div></div>
    </a>\`)
  ].filter(Boolean).join("");

  const reviewsHtml = (m.reviews || []).map(r => \`
    <div class="review-card">
      <div class="review-header">
        <span class="review-author">👤 \${r.author}</span>
        \${r.rating ? \`<span class="review-rating">★ \${r.rating}/10</span>\` : ""}
      </div>
      <div class="review-text">\${r.content}</div>
      \${r.url ? \`<a href="\${r.url}" target="_blank" style="font-size:11px;color:var(--red);margin-top:8px;display:inline-block">Leer completa →</a>\` : ""}
    </div>
  \`).join("");

  const backdropsHtml = (m.backdrops || []).map(b => 
    \`<img class="backdrop-thumb" src="\${b}" loading="lazy" alt="imagen" onerror="this.style.display='none'">\`
  ).join("");

  modal.innerHTML = \`
    <div style="position:relative">
      <button class="modal-close" onclick="closeModal()">✕</button>
      \${m.backdrop
        ? \`<img class="modal-backdrop" src="\${m.backdrop}" alt="\${m.title}" onerror="this.style.display='none'">\`
        : \`<div style="height:140px;background:var(--bg3)"></div>\`}
    </div>
    <div class="modal-body">
      <div class="modal-title">\${m.title}</div>
      \${m.tagline ? \`<div class="modal-tagline">"\${m.tagline}"</div>\` : ""}
      <div class="modal-stats">\${statsHtml}</div>

      \${m.overview ? \`<div class="modal-overview">\${m.overview}</div>\` : ""}

      <div class="modal-section-title">GÉNEROS · PAÍSES · ESTUDIOS</div>
      <div style="margin-bottom:24px;font-size:13px;color:var(--muted)">
        \${[...(m.genres||[]), ...(m.countries||[]), ...(m.studios||[])].join(" · ")}
      </div>

      \${castHtml ? \`
        <div class="modal-section-title">REPARTO</div>
        <div class="cast-grid">\${castHtml}</div>
      \` : ""}

      \${videosHtml ? \`
        <div class="modal-section-title">VIDEOS</div>
        <div class="videos-list">\${videosHtml}</div>
      \` : ""}

      \${backdropsHtml ? \`
        <div class="modal-section-title">IMÁGENES</div>
        <div class="backdrops-scroll">\${backdropsHtml}</div>
      \` : ""}

      \${reviewsHtml ? \`
        <div class="modal-section-title">RESEÑAS DE USUARIOS</div>
        <div class="reviews-list">\${reviewsHtml}</div>
      \` : ""}

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
        \${m.trailer ? \`<a href="\${m.trailer.url}" target="_blank" class="btn btn-red">▶ VER TRAILER</a>\` : ""}
        \${m.imdbId ? \`<a href="https://www.imdb.com/title/\${m.imdbId}" target="_blank" class="btn btn-gold">IMDb</a>\` : ""}
        <a href="\${m.tmdbUrl}" target="_blank" class="btn btn-outline">TMDB</a>
      </div>
    </div>
  \`;

  document.getElementById("modal-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal(event) {
  if (event && event.target !== document.getElementById("modal-overlay")) return;
  document.getElementById("modal-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

// Auto-refresh cada 30 minutos
loadData();
setInterval(loadData, 30 * 60 * 1000);
</script>
</body>
</html>`;
const LIVE_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>ElFilme · En Vivo</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
:root{
  --bg:#0a0a0a;--bg2:#0f0f0f;--bg3:#141414;
  --accent:#e50914;--accent2:#ff1a1a;
  --text:#fff;--muted:#888;--border:rgba(255,255,255,0.08);
  --blur:blur(12px);
}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden;}

/* LIVE PULSE */
@keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.6;transform:scale(1.15);}}
@keymexframes glow{0%,100%{box-shadow:0 0 10px rgba(229,9,20,0.5);}50%{box-shadow:0 0 25px rgba(229,9,20,0.9);}}
@keyframes scanline{0%{transform:translateY(-100%);}100%{transform:translateY(100vh);}}
@keyframes fadeIn{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}

/* SCANLINE EFFECT */
body::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px);pointer-events:none;z-index:1000;}

/* HEADER */
header{position:sticky;top:0;z-index:200;background:rgba(10,10,10,0.95);backdrop-filter:var(--blur);border-bottom:1px solid var(--border);padding:0 1.5rem;height:64px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-family:'Bebas Neue',sans-serif;font-size:1.8rem;color:var(--accent);letter-spacing:2px;text-decoration:none;}
.live-badge{display:flex;align-items:center;gap:.5rem;background:rgba(229,9,20,0.15);border:1px solid rgba(229,9,20,0.4);border-radius:4px;padding:5px 12px;font-size:.75rem;font-weight:600;letter-spacing:1px;color:var(--accent);}
.live-dot{width:8px;height:8px;background:var(--accent);border-radius:50%;animation:pulse 1.5s ease-in-out infinite;}
.header-right{display:flex;align-items:center;gap:1rem;}
.back-btn{background:var(--bg3);border:1px solid var(--border);color:var(--muted);padding:7px 16px;border-radius:4px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:.82rem;transition:all .2s;}
.back-btn:hover{color:var(--text);border-color:rgba(255,255,255,0.2);}
.viewer-count{display:flex;align-items:center;gap:.4rem;color:var(--muted);font-size:.8rem;}

/* MAIN LAYOUT */
.live-container{display:grid;grid-template-columns:1fr 360px;gap:0;height:calc(100vh - 64px);max-height:calc(100vh - 64px);}

/* PLAYER SIDE */
.player-side{display:flex;flex-direction:column;background:var(--bg);border-right:1px solid var(--border);}
.player-wrap{position:relative;width:100%;background:#000;flex:1;}
.player-wrap iframe{width:100%;height:100%;border:none;display:block;}

/* OFFLINE STATE */
.offline-state{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:1.5rem;animation:fadeIn .5s ease;}
.offline-icon{font-size:4rem;opacity:.3;}
.offline-title{font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:2px;color:var(--muted);}
.offline-sub{color:var(--muted);font-size:.85rem;text-align:center;max-width:300px;line-height:1.6;}
.offline-channel{display:flex;align-items:center;gap:.5rem;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 20px;color:var(--muted);font-size:.85rem;}
.offline-channel a{color:var(--accent);text-decoration:none;}

/* STREAM INFO */
.stream-info{padding:1rem 1.5rem;border-top:1px solid var(--border);background:var(--bg2);}
.stream-title{font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:1px;margin-bottom:.3rem;}
.stream-meta{display:flex;align-items:center;gap:1rem;color:var(--muted);font-size:.8rem;}
.stream-meta span{display:flex;align-items:center;gap:.3rem;}

/* CHAT SIDE */
.chat-side{display:flex;flex-direction:column;background:var(--bg2);height:100%;}
.chat-header{padding:1rem 1.2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.chat-title{font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:1px;}
.chat-toggle{display:flex;gap:.4rem;}
.chat-toggle-btn{background:transparent;border:1px solid var(--border);color:var(--muted);padding:4px 12px;border-radius:3px;cursor:pointer;font-size:.75rem;font-family:'DM Sans',sans-serif;transition:all .2s;}
.chat-toggle-btn.active{background:rgba(229,9,20,0.15);border-color:rgba(229,9,20,0.4);color:var(--accent);}

/* YOUTUBE CHAT */
.yt-chat-wrap{flex:1;overflow:hidden;}
.yt-chat-wrap iframe{width:100%;height:100%;border:none;}

/* CUSTOM CHAT */
.custom-chat{display:none;flex-direction:column;flex:1;overflow:hidden;}
.custom-chat.active{display:flex;}
.yt-chat-wrap.hidden{display:none;}
.chat-messages{flex:1;overflow-y:auto;padding:.8rem;display:flex;flex-direction:column;gap:.5rem;scroll-behavior:smooth;}
.chat-messages::-webkit-scrollbar{width:4px;}
.chat-messages::-webkit-scrollbar-track{background:transparent;}
.chat-messages::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}
.chat-msg{animation:fadeIn .3s ease;}
.chat-msg-user{font-size:.78rem;font-weight:600;color:var(--accent);margin-bottom:2px;}
.chat-msg-text{font-size:.82rem;color:#ccc;line-height:1.4;word-break:break-word;}
.chat-msg-time{font-size:.7rem;color:var(--muted);margin-top:2px;}
.chat-input-area{padding:.8rem;border-top:1px solid var(--border);display:flex;gap:.5rem;}
.chat-input{flex:1;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:4px;font-family:'DM Sans',sans-serif;font-size:.83rem;outline:none;transition:border-color .2s;}
.chat-input:focus{border-color:rgba(229,9,20,0.4);}
.chat-send{background:var(--accent);border:none;color:#fff;padding:9px 16px;border-radius:4px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:.83rem;font-weight:600;transition:background .2s;white-space:nowrap;}
.chat-send:hover{background:var(--accent2);}

/* ADMIN PANEL */
.admin-bar{background:rgba(229,9,20,0.08);border-bottom:1px solid rgba(229,9,20,0.2);padding:.6rem 1.5rem;display:none;align-items:center;gap:1rem;}
.admin-bar.visible{display:flex;}
.admin-bar input{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 12px;border-radius:4px;font-family:'DM Sans',sans-serif;font-size:.82rem;flex:1;outline:none;}
.admin-bar input:focus{border-color:rgba(229,9,20,0.4);}
.admin-bar button{background:var(--accent);border:none;color:#fff;padding:6px 16px;border-radius:4px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:.82rem;font-weight:600;white-space:nowrap;}
.admin-bar label{color:var(--muted);font-size:.78rem;white-space:nowrap;}

/* AUTH OVERLAY */
.auth-overlay{position:fixed;inset:0;background:rgba(5,5,5,0.95);z-index:500;display:flex;align-items:center;justify-content:center;}
.auth-box{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:2.5rem;width:100%;max-width:380px;text-align:center;}
.auth-logo{font-family:'Bebas Neue',sans-serif;font-size:2.5rem;color:var(--accent);letter-spacing:3px;margin-bottom:.5rem;}
.auth-sub{color:var(--muted);font-size:.85rem;margin-bottom:2rem;}
.auth-btn{background:var(--accent);color:#fff;border:none;padding:12px 32px;border-radius:4px;font-family:'DM Sans',sans-serif;font-size:.95rem;font-weight:600;cursor:pointer;width:100%;}

/* MOBILE */
@media(max-width:768px){
  .live-container{grid-template-columns:1fr;grid-template-rows:auto 1fr;height:auto;max-height:none;}
  .player-side{height:auto;}
  .player-wrap{aspect-ratio:16/9;height:auto;}
  .chat-side{height:420px;}
  header{padding:0 1rem;}
  .logo{font-size:1.5rem;}
}
</style>
</head>
<body>

<!-- AUTH OVERLAY -->
<div class="auth-overlay" id="authOverlay">
  <div class="auth-box">
    <img src="https://elfilme.com/copilot_image_1772812453252.jpeg" style="width:70px;height:70px;border-radius:50%;object-fit:cover;margin-bottom:1rem;"/>
    <div class="auth-logo">ELFILME</div>
    <p class="auth-sub">El contenido en vivo es exclusivo para miembros VIP</p>
    <button class="auth-btn" onclick="window.location.href='/login'">Iniciar Sesión</button>
  </div>
</div>

<!-- HEADER -->
<header>
  <a href="/" class="logo" style="display:flex;align-items:center;gap:.6rem;"><img src="https://elfilme.com/copilot_image_1772812453252.jpeg" style="width:36px;height:36px;border-radius:50%;object-fit:cover;"/>ElFilme</a>
  <div class="live-badge" id="liveBadge" style="display:none">
    <div class="live-dot"></div>
    EN VIVO
  </div>
  <div class="header-right">
    <div class="viewer-count" id="viewerCount" style="display:none">👁 <span id="viewerNum">0</span> viendo</div>
    <button class="back-btn" onclick="window.location.href='/'">← Volver</button>
  </div>
</header>

<!-- ADMIN BAR -->
<div class="admin-bar" id="adminBar">
  <label>Video ID:</label>
  <input type="text" id="videoIdInput" placeholder="Ej: dQw4w9WgXcQ (ID del video de YouTube)"/>
  <button onclick="setStream()">🔴 Ir en Vivo</button>
  <button onclick="endStream()" style="background:#333;">⬛ Terminar</button>
</div>

<!-- MAIN -->
<div class="live-container">

  <!-- PLAYER -->
  <div class="player-side">
    <div class="player-wrap" id="playerWrap">
      <div class="offline-state" id="offlineState">
        <div class="offline-icon">📺</div>
        <div class="offline-title">Sin transmisión activa</div>
        <p class="offline-sub">El canal no está transmitiendo en este momento. Vuelve pronto.</p>
        <div class="offline-channel">Síguenos en YouTube: <a href="https://youtube.com/@synaptlive" target="_blank">@synaptlive</a></div>
      </div>
    </div>
    <div class="stream-info" id="streamInfo" style="display:none">
      <div class="stream-title" id="streamTitle">Transmisión en Vivo</div>
      <div class="stream-meta">
        <span>🔴 En vivo</span>
        <span>📺 <a href="https://youtube.com/@synaptlive" target="_blank" style="color:var(--accent);text-decoration:none;">@synaptlive</a></span>
      </div>
    </div>
  </div>

  <!-- CHAT -->
  <div class="chat-side">
    <div class="chat-header">
      <div class="chat-title">💬 Chat en Vivo</div>
      <div class="chat-toggle">
        <button class="chat-toggle-btn active" id="btnYT" onclick="switchChat('yt')">YouTube</button>
        <button class="chat-toggle-btn" id="btnCustom" onclick="switchChat('custom')">ElFilme</button>
      </div>
    </div>

    <!-- YouTube Chat -->
    <div class="yt-chat-wrap" id="ytChatWrap">
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:1rem;color:var(--muted);">
        <div style="font-size:2rem;">💬</div>
        <div style="font-size:.85rem;text-align:center;padding:0 2rem;line-height:1.6;">El chat de YouTube aparecerá aquí cuando haya una transmisión activa.</div>
      </div>
    </div>

    <!-- Custom Chat -->
    <div class="custom-chat" id="customChat">
      <div class="chat-messages" id="chatMessages">
        <div style="text-align:center;color:var(--muted);font-size:.8rem;padding:1rem;">Chat de ElFilme — Solo miembros VIP</div>
      </div>
      <div class="chat-input-area">
        <input type="text" class="chat-input" id="chatInput" placeholder="Escribe un mensaje..." maxlength="200" onkeydown="if(event.key==='Enter')sendMsg()"/>
        <button class="chat-send" onclick="sendMsg()">Enviar</button>
      </div>
    </div>
  </div>
</div>

<script>
const JSONBIN_KEY = '$2a$10$zfpeUDAI8NJCOd7IfxwK/ezp25/JUIeEJAfShlUtPSqbOl4CfDRKa';
const JSONBIN_BASE = 'https://api.jsonbin.io/v3';
const CHAT_BIN = '69a7219c43b1c97be9afe670'; // uses same bin, stores in settings.live
let currentUser = null;
let currentVideoId = null;
let chatInterval = null;
let lastMsgCount = 0;

// AUTH CHECK
function checkAuth(){
  const u = localStorage.getItem('elfilme_user');
  if(!u){ document.getElementById('authOverlay').style.display='flex'; return; }
  currentUser = JSON.parse(u);
  document.getElementById('authOverlay').style.display='none';
  // Check if admin
  const settings = JSON.parse(localStorage.getItem('synaptstream_settings')||'{}');
  if(currentUser.username === 'admin' || localStorage.getItem('elfilme_isadmin')==='true'){
    document.getElementById('adminBar').classList.add('visible');
  }
  loadLiveState();
}

// LOAD LIVE STATE from JSONBin
async function loadLiveState(){
  try{
    const res = await fetch(\`\${JSONBIN_BASE}/b/\${CHAT_BIN}/latest\`,{headers:{'X-Master-Key':JSONBIN_KEY}});
    const data = await res.json();
    const live = data.record.settings?.live;
    if(live && live.videoId){
      startPlayerEmbed(live.videoId, live.title||'Transmisión en Vivo');
    }
    // Load chat messages
    const msgs = data.record.settings?.chatMessages || [];
    renderMessages(msgs);
    lastMsgCount = msgs.length;
  }catch(e){}
  // Poll every 8 seconds
  chatInterval = setInterval(pollChat, 8000);
}

async function pollChat(){
  try{
    const res = await fetch(\`\${JSONBIN_BASE}/b/\${CHAT_BIN}/latest\`,{headers:{'X-Master-Key':JSONBIN_KEY}});
    const data = await res.json();
    const msgs = data.record.settings?.chatMessages || [];
    if(msgs.length !== lastMsgCount){
      renderMessages(msgs);
      lastMsgCount = msgs.length;
    }
    // Check if live state changed
    const live = data.record.settings?.live;
    if(live && live.videoId && live.videoId !== currentVideoId){
      startPlayerEmbed(live.videoId, live.title||'Transmisión en Vivo');
    } else if(!live && currentVideoId){
      endStreamView();
    }
  }catch(e){}
}

function renderMessages(msgs){
  const container = document.getElementById('chatMessages');
  if(!msgs.length) return;
  container.innerHTML = msgs.slice(-100).map(m=>\`
    <div class="chat-msg">
      <div class="chat-msg-user">\${escHtml(m.user)}</div>
      <div class="chat-msg-text">\${escHtml(m.text)}</div>
      <div class="chat-msg-time">\${m.time||''}</div>
    </div>
  \`).join('');
  container.scrollTop = container.scrollHeight;
}

function escHtml(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function sendMsg(){
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if(!text || !currentUser) return;
  input.value = '';
  const now = new Date();
  const time = now.getHours()+':'+(now.getMinutes()<10?'0':'')+now.getMinutes();
  try{
    const res = await fetch(\`\${JSONBIN_BASE}/b/\${CHAT_BIN}/latest\`,{headers:{'X-Master-Key':JSONBIN_KEY}});
    const data = await res.json();
    const record = data.record;
    if(!record.settings) record.settings = {};
    if(!record.settings.chatMessages) record.settings.chatMessages = [];
    record.settings.chatMessages.push({user:currentUser.username, text, time});
    // Keep last 200 messages
    if(record.settings.chatMessages.length > 200) record.settings.chatMessages = record.settings.chatMessages.slice(-200);
    await fetch(\`\${JSONBIN_BASE}/b/\${CHAT_BIN}\`,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_KEY},body:JSON.stringify(record)});
    renderMessages(record.settings.chatMessages);
    lastMsgCount = record.settings.chatMessages.length;
  }catch(e){ alert('Error al enviar mensaje'); }
}

// ADMIN: Set stream
async function setStream(){
  const videoId = document.getElementById('videoIdInput').value.trim();
  if(!videoId){ alert('Ingresa el ID del video'); return; }
  try{
    const res = await fetch(\`\${JSONBIN_BASE}/b/\${CHAT_BIN}/latest\`,{headers:{'X-Master-Key':JSONBIN_KEY}});
    const data = await res.json();
    const record = data.record;
    if(!record.settings) record.settings = {};
    record.settings.live = {videoId, title:'Transmisión en Vivo — ElFilme', startedAt: new Date().toISOString()};
    await fetch(\`\${JSONBIN_BASE}/b/\${CHAT_BIN}\`,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_KEY},body:JSON.stringify(record)});
    startPlayerEmbed(videoId, 'Transmisión en Vivo — ElFilme');
  }catch(e){ alert('Error'); }
}

async function endStream(){
  if(!confirm('¿Terminar la transmisión?')) return;
  try{
    const res = await fetch(\`\${JSONBIN_BASE}/b/\${CHAT_BIN}/latest\`,{headers:{'X-Master-Key':JSONBIN_KEY}});
    const data = await res.json();
    const record = data.record;
    if(record.settings) record.settings.live = null;
    await fetch(\`\${JSONBIN_BASE}/b/\${CHAT_BIN}\`,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_KEY},body:JSON.stringify(record)});
    endStreamView();
  }catch(e){}
}

function startPlayerEmbed(videoId, title){
  currentVideoId = videoId;
  const pw = document.getElementById('playerWrap');
  pw.innerHTML = \`<iframe src="https://www.youtube.com/embed/\${videoId}?autoplay=1&rel=0" allowfullscreen allow="autoplay; encrypted-media" style="width:100%;height:100%;border:none;"></iframe>\`;
  // YouTube chat
  document.getElementById('ytChatWrap').innerHTML = \`<iframe src="https://www.youtube.com/live_chat?v=\${videoId}&embed_domain=\${location.hostname||'elfilme.com'}" style="width:100%;height:100%;border:none;"></iframe>\`;
  document.getElementById('liveBadge').style.display='flex';
  document.getElementById('viewerCount').style.display='flex';
  document.getElementById('streamInfo').style.display='block';
  document.getElementById('streamTitle').textContent = title;
}

function endStreamView(){
  currentVideoId = null;
  document.getElementById('playerWrap').innerHTML = \`<div class="offline-state"><div class="offline-icon">📺</div><div class="offline-title">Transmisión finalizada</div><p class="offline-sub">Gracias por ver. Vuelve pronto para el próximo live.</p><div class="offline-channel">Síguenos: <a href="https://youtube.com/@synaptlive" target="_blank">@synaptlive</a></div></div>\`;
  document.getElementById('liveBadge').style.display='none';
  document.getElementById('viewerCount').style.display='none';
  document.getElementById('streamInfo').style.display='none';
}

function switchChat(mode){
  const ytWrap = document.getElementById('ytChatWrap');
  const customChat = document.getElementById('customChat');
  const btnYT = document.getElementById('btnYT');
  const btnCustom = document.getElementById('btnCustom');
  if(mode==='yt'){
    ytWrap.classList.remove('hidden');
    customChat.classList.remove('active');
    btnYT.classList.add('active');
    btnCustom.classList.remove('active');
  } else {
    ytWrap.classList.add('hidden');
    customChat.classList.add('active');
    btnYT.classList.remove('active');
    btnCustom.classList.add('active');
  }
}

checkAuth();
</script>
</body>
</html>
`;
const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><title>ElFilme 404</title>
<style>body{background:#0a0a0a;color:#e5e5e5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}h1{font-size:5rem;color:#e50914;}a{color:#e50914;text-decoration:none;display:block;margin-top:1rem;}</style>
</head><body><div><h1>404</h1><p>Página no encontrada</p><a href="/">← Volver</a></div></body></html>`;
