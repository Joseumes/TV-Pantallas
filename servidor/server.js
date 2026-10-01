'use strict';

/*
 * Servidor de pantallas institucionales.
 *
 * - REST (exige X-Api-Key, salvo /api/salud):
 *     GET    /api/salud
 *     GET    /api/pantallas
 *     POST   /api/sesiones            { streamId, deviceIds[] }
 *     DELETE /api/sesiones/:id
 * - WebSocket /ws/senalizacion (sin API Key; la TV se autentica con su token):
 *     TV->S: register, ping, answer, ice
 *     S->TV: registered, pong, stream_start, stream_stop, offer, ice
 *     Emisora->S: hello_emisora, offer{toDevice}, ice{toDevice}, stream_stop
 *     S->Emisora: hello_ok, tv_online, tv_offline, answer, ice
 * - Web estático (panel + emisora) desde ../web
 *
 * El WebSocket NO lleva vídeo: solo SDP/ICE/control. El vídeo va por WebRTC
 * directo laptop -> TV (una RTCPeerConnection por pantalla).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DIR = __dirname;
const CONFIG = leerJson(path.join(DIR, 'config.json'), {});
const PUERTO = process.env.PUERTO || CONFIG.puerto || 8080;
const API_KEY = process.env.API_KEY || CONFIG.apiKey || '';
const TIMEOUT_MS = (CONFIG.pingTimeoutSeg || 20) * 1000;
const RUTA_DATOS = path.join(DIR, 'pantallas.json');
const RUTA_WEB = path.join(DIR, '..', 'web');

//--- Estado ---------------------------------------------------------------

const pantallas = new Map();   // deviceId -> { deviceId, nombre, ip, version, token, ultimaConexion, ultimoPing, enTransmision }
const sesiones = new Map();    // sessionId -> { sessionId, streamId, participantes, creada }
const socketsTv = new Map();   // deviceId -> ws
const wsTvInverso = new Map(); // ws -> deviceId
const emisoras = new Set();    // ws

function leerJson(ruta, defecto) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return defecto;
  }
}

function guardar() {
  try {
    fs.writeFileSync(RUTA_DATOS, JSON.stringify([...pantallas.values()], null, 2));
  } catch (e) {
    console.error('No se pudo guardar pantallas.json:', e.message);
  }
}

function cargar() {
  const lista = leerJson(RUTA_DATOS, []);
  for (const p of lista) {
    p.enTransmision = false; // al arrancar nadie transmite
    pantallas.set(p.deviceId, p);
  }
}

function estadoDe(p) {
  if (Date.now() - p.ultimoPing > TIMEOUT_MS) return 'offline';
  return p.enTransmision ? 'streaming' : 'online';
}

/** IP LAN del servidor para mostrarla en el panel (qué escribir en cada TV). */
function ipLocal() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

function datosConexion() {
  const ip = ipLocal();
  return { ip, puerto: PUERTO, ws: `ws://${ip}:${PUERTO}/ws/senalizacion` };
}

/** Ficha de aprovisionamiento: lo que hay que escribir en la pantalla Config de la APK. */
function fichaTv(p) {
  const c = datosConexion();
  return {
    deviceId: p.deviceId, nombre: p.nombre, grupo: p.grupo || 'lab1', token: p.token,
    servidor: c.ip, puerto: c.puerto, ws: c.ws,
  };
}

/** Normaliza el grupo (lab1, lab2...): minúsculas, sin espacios. */
function slugGrupo(x) {
  return String(x || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'lab1';
}

//--- HTTP -----------------------------------------------------------------

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function responder(res, codigo, objeto) {
  const cuerpo = JSON.stringify(objeto);
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let datos = '';
    req.on('data', (c) => { datos += c; });
    req.on('end', () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

function conApiKey(req, res) {
  if (req.headers['x-api-key'] !== API_KEY) {
    responder(res, 401, { title: 'No autorizado', detail: 'Falta X-Api-Key o es incorrecta.' });
    return false;
  }
  return true;
}

async function atenderHttp(req, res) {
  const url = new URL(req.url, 'http://local');
  const ruta = url.pathname;

  if (ruta === '/config-web.js') {
    // Clave embebida para no pegarla en cada máquina (red local cerrada).
    const key = String(API_KEY).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(`window.PANTALLAS_API_KEY="${key}";`);
    return;
  }

  if (ruta === '/api/salud') {
    return responder(res, 200, { estado: 'ok', pantallas: pantallas.size, sesiones: sesiones.size, fechaHora: new Date() });
  }

  if (ruta === '/api/pantallas' && req.method === 'GET') {
    if (!conApiKey(req, res)) return;
    return responder(res, 200, {
      servidor: datosConexion(),
      pantallas: [...pantallas.values()].map((p) => ({
        deviceId: p.deviceId, nombre: p.nombre, grupo: p.grupo || 'lab1', ip: p.ip, version: p.version,
        token: p.token,
        estado: estadoDe(p), ultimaConexion: p.ultimaConexion,
        enTransmision: p.enTransmision,
        conectadaWs: (socketsTv.get(p.deviceId) || {}).readyState === 1,
      })),
      sesiones: [...sesiones.values()],
    });
  }

  if (ruta === '/api/pantallas' && req.method === 'POST') {
    // Pre-registro desde la web: crea la TV y devuelve la ficha con el token
    // para escribirla en la pantalla Config de la APK.
    if (!conApiKey(req, res)) return;
    const cuerpo = await leerCuerpo(req);
    const id = String((cuerpo && cuerpo.deviceId) || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-_]{2,31}$/.test(id)) {
      return responder(res, 400, { title: 'Código inválido', detail: 'Usa 3-32 caracteres A-Z 0-9 - _ (ej. SALON-01).' });
    }
    let p = pantallas.get(id);
    if (!p) {
      p = {
        deviceId: id, nombre: id, grupo: slugGrupo(cuerpo.grupo), ip: '', version: '',
        token: crypto.randomBytes(16).toString('hex'),
        ultimaConexion: null, ultimoPing: 0, enTransmision: false,
      };
      pantallas.set(id, p);
    }
    if (cuerpo.nombre && String(cuerpo.nombre).trim()) p.nombre = String(cuerpo.nombre).trim();
    if (cuerpo.grupo !== undefined && cuerpo.grupo !== null && String(cuerpo.grupo).trim() !== '') {
      p.grupo = slugGrupo(cuerpo.grupo);
    }
    guardar();
    return responder(res, 200, fichaTv(p));
  }

  const mTok = ruta.match(/^\/api\/pantallas\/([\w-]+)\/token$/);
  if (mTok && req.method === 'POST') {
    // Regenera el token (la TV queda fuera hasta escribir el nuevo en su Config).
    if (!conApiKey(req, res)) return;
    const p = pantallas.get(mTok[1].toUpperCase());
    if (!p) return responder(res, 404, { title: 'No existe', detail: 'Ese código no está registrado.' });
    p.token = crypto.randomBytes(16).toString('hex');
    guardar();
    const ws = socketsTv.get(p.deviceId);
    if (ws) { try { ws.close(4000, 'token regenerado'); } catch {} }
    return responder(res, 200, fichaTv(p));
  }

  const mDel = ruta.match(/^\/api\/pantallas\/([\w-]+)$/);
  if (mDel && req.method === 'DELETE') {
    if (!conApiKey(req, res)) return;
    const id = mDel[1].toUpperCase();
    if (!pantallas.has(id)) return responder(res, 404, { title: 'No existe', detail: 'Ese código no está registrado.' });
    pantallas.delete(id);
    const ws = socketsTv.get(id);
    if (ws) {
      socketsTv.delete(id);
      try { ws.close(4000, 'TV eliminada'); } catch {}
    }
    guardar();
    return responder(res, 200, { deviceId: id, eliminada: true });
  }

  const mPut = ruta.match(/^\/api\/pantallas\/([\w-]+)$/);
  if (mPut && req.method === 'PUT') {
    // Editar nombre/grupo desde la web (la web manda; la TV no los pisa).
    if (!conApiKey(req, res)) return;
    const p = pantallas.get(mPut[1].toUpperCase());
    if (!p) return responder(res, 404, { title: 'No existe', detail: 'Ese código no está registrado.' });
    const cuerpo = await leerCuerpo(req);
    if (cuerpo) {
      if (cuerpo.nombre && String(cuerpo.nombre).trim()) p.nombre = String(cuerpo.nombre).trim();
      if (cuerpo.grupo !== undefined && cuerpo.grupo !== null && String(cuerpo.grupo).trim() !== '') {
        p.grupo = slugGrupo(cuerpo.grupo);
      }
    }
    guardar();
    return responder(res, 200, fichaTv(p));
  }

  if (ruta === '/api/sesiones' && req.method === 'POST') {
    if (!conApiKey(req, res)) return;
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo || !Array.isArray(cuerpo.deviceIds) || !cuerpo.deviceIds.length) {
      return responder(res, 400, { title: 'Sin pantallas', detail: 'Indica deviceIds.' });
    }
    const conocidas = [...new Set(cuerpo.deviceIds.map((x) => String(x).trim()))]
      .filter((id) => pantallas.has(id));
    if (!conocidas.length) {
      return responder(res, 400, { title: 'Sin pantallas conocidas', detail: 'Ningún deviceId está registrado.' });
    }
    // Una TV = una transmisión: las que ya están en otra sesión se omiten
    // (así ningún lab le quita TVs a otro por accidente).
    const omitidas = conocidas.filter((id) => enSesionDe(id));
    const libres = conocidas.filter((id) => !enSesionDe(id));
    if (!libres.length) {
      return responder(res, 409, { title: 'Todas ocupadas', detail: 'Esas TVs ya están en otra sesión. Detén esa sesión primero.', omitidas });
    }
    const sesion = {
      sessionId: crypto.randomBytes(4).toString('hex'),
      streamId: (cuerpo.streamId || 'laptop-01').trim() || 'laptop-01',
      participantes: libres,
      creada: new Date(),
      ultimoMovimiento: Date.now(),
    };
    sesiones.set(sesion.sessionId, sesion);
    for (const id of libres) pantallas.get(id).enTransmision = true;
    for (const id of libres) {
      enviarATv(id, { type: 'stream_start', sessionId: sesion.sessionId, streamId: sesion.streamId });
    }
    sesion.omitidas = omitidas;
    return responder(res, 200, sesion);
  }

  const m = ruta.match(/^\/api\/sesiones\/([\w-]+)$/);
  if (m && req.method === 'DELETE') {
    if (!conApiKey(req, res)) return;
    const s = terminarSesion(m[1]);
    avisarSesion(s, { type: 'stream_stop', sessionId: m[1] });
    return responder(res, 200, { sessionId: m[1], detenida: !!s });
  }

  // Web estático
  if (!ruta.startsWith('/api/') && !ruta.startsWith('/ws/')) {
    const archivo = path.normalize(path.join(RUTA_WEB, ruta === '/' ? 'pantallas.html' : '.' + ruta));
    if (!archivo.startsWith(RUTA_WEB) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      res.writeHead(404); res.end('No encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
    return;
  }

  res.writeHead(404); res.end('No encontrado');
}

function terminarSesion(sessionId) {
  const s = sesiones.get(sessionId);
  if (!s) return null;
  sesiones.delete(sessionId);
  for (const id of s.participantes) {
    const p = pantallas.get(id);
    if (p) p.enTransmision = false;
  }
  return s;
}

/** Sesión activa que ya contiene a esta TV (una TV = una transmisión). */
function enSesionDe(deviceId) {
  for (const s of sesiones.values()) {
    if (s.participantes.includes(deviceId)) return s;
  }
  return null;
}

function tocarSesion(sessionId) {
  const s = sesiones.get(sessionId);
  if (s) s.ultimoMovimiento = Date.now();
}
function avisarSesion(sesion, objeto) {
  if (!sesion) return;
  for (const id of sesion.participantes) enviarATv(id, objeto);
}

//--- WebSocket --------------------------------------------------------------

function enviar(ws, objeto) {
  if (ws.readyState === 1) ws.send(JSON.stringify(objeto));
}

function enviarATv(deviceId, objeto) {
  const ws = socketsTv.get(deviceId);
  if (ws) enviar(ws, objeto);
}

function avisarEmisoras(objeto) {
  for (const ws of emisoras) enviar(ws, objeto);
}

function atenderWs(ws, req) {
  const ip = req.socket.remoteAddress || '';
  let deviceId = null;

  ws.on('message', (crudo) => {
    let m;
    try {
      m = JSON.parse(crudo.toString());
    } catch {
      return;
    }

    switch (m.type) {
      case 'register': {
        const id = String(m.deviceId || '').trim();
        if (!id) return enviar(ws, { type: 'error', detail: 'deviceId vacío' });
        const previo = pantallas.get(id);
        if (previo && previo.token && previo.token !== (m.token || '')) {
          return enviar(ws, { type: 'error', detail: 'token inválido' });
        }
        // La web es la fuente de nombre/grupo: solo se fijan al crear.
        // Así la TV queda configurada una sola vez y no se desconfigura.
        let reg = previo;
        if (!reg) {
          reg = {
            deviceId: id, nombre: (m.name || '').trim() || id,
            grupo: 'lab1', ip: '', version: '',
            token: crypto.randomBytes(16).toString('hex'),
            ultimaConexion: new Date(),
          };
          pantallas.set(id, reg);
        }
        reg.ip = (m.ip || '').trim() || ip;
        reg.version = m.version || '';
        reg.ultimaConexion = new Date();
        reg.ultimoPing = Date.now();
        pantallas.set(id, reg);
        guardar();
        deviceId = id;
        socketsTv.set(id, ws);
        wsTvInverso.set(ws, id);
        enviar(ws, { type: 'registered', deviceId: id, status: 'online', token: reg.token });
        avisarEmisoras({ type: 'tv_online', deviceId: id, nombre: reg.nombre, grupo: reg.grupo || 'lab1' });
        break;
      }

      case 'ping': {
        const p = pantallas.get(m.deviceId);
        if (p) p.ultimoPing = Date.now();
        enviar(ws, { type: 'pong' });
        break;
      }

      case 'hello_emisora':
        emisoras.add(ws);
        enviar(ws, { type: 'hello_ok' });
        // TVs ya conectadas: la emisora no vio sus tv_online, se las listamos.
        enviar(ws, {
          type: 'tv_list',
          tvs: [...socketsTv.entries()]
            .filter(([, s]) => s.readyState === 1)
            .map(([id]) => {
              const pp = pantallas.get(id) || {};
              return { deviceId: id, nombre: pp.nombre || id, grupo: pp.grupo || 'lab1' };
            }),
        });
        break;

      case 'offer':
        tocarSesion(m.sessionId);
        if (m.toDevice) {
          enviarATv(m.toDevice, { type: 'offer', sessionId: m.sessionId, from: deviceId, sdp: m.sdp });
        }
        break;

      case 'answer':
        tocarSesion(m.sessionId);
        if (m.toDevice) {
          enviarATv(m.toDevice, { type: 'answer', sessionId: m.sessionId, from: deviceId, sdp: m.sdp });
        } else {
          avisarEmisoras({ type: 'answer', sessionId: m.sessionId, from: deviceId, sdp: m.sdp });
        }
        break;

      case 'ice':
        tocarSesion(m.sessionId);
        if (m.toDevice) {
          enviarATv(m.toDevice, { type: 'ice', sessionId: m.sessionId, from: deviceId, candidate: m.candidate });
        } else {
          avisarEmisoras({ type: 'ice', sessionId: m.sessionId, from: deviceId, candidate: m.candidate });
        }
        break;

      case 'session_ping':
        // La emisora lo envía cada 20 s mientras transmite: mantiene viva la sesión.
        tocarSesion(m.sessionId);
        break;

      case 'stream_stop':
        if (m.sessionId) {
          const s = terminarSesion(m.sessionId);
          avisarSesion(s, { type: 'stream_stop', sessionId: m.sessionId });
        }
        break;
    }
  });

  ws.on('close', () => {
    emisoras.delete(ws);
    const id = wsTvInverso.get(ws);
    if (id) {
      wsTvInverso.delete(ws);
      if (socketsTv.get(id) === ws) socketsTv.delete(id);
      avisarEmisoras({ type: 'tv_offline', deviceId: id });
    }
  });
}

//--- Arranque ---------------------------------------------------------------

if (!API_KEY || API_KEY === 'CAMBIA-ESTA-CLAVE-POR-UNA-LARGA-Y-ALEATORIA') {
  console.error('Falta apiKey: edita servidor/config.json o define API_KEY antes de arrancar.');
  process.exit(78);
}

cargar();
const server = http.createServer(atenderHttp);
const wss = new WebSocketServer({ server, path: '/ws/senalizacion' });
wss.on('connection', atenderWs);

// HTTPS opcional (para emitir desde cualquier PC: getDisplayMedia exige
// contexto seguro). Si config.json trae https.keyFile/certFile y existen,
// se levanta en paralelo; el WS usa wss:// automáticamente.
try {
  const hk = CONFIG.https && CONFIG.https.keyFile;
  const hc = CONFIG.https && CONFIG.https.certFile;
  const rk = hk && path.join(DIR, hk);
  const rc = hc && path.join(DIR, hc);
  if (rk && rc && fs.existsSync(rk) && fs.existsSync(rc)) {
    const https = require('https');
    const PUERTO_HTTPS = process.env.PUERTO_HTTPS || (CONFIG.https && CONFIG.https.puerto) || 8443;
    const httpsServer = https.createServer({
      key: fs.readFileSync(rk),
      cert: fs.readFileSync(rc),
    }, atenderHttp);
    const wss2 = new WebSocketServer({ server: httpsServer, path: '/ws/senalizacion' });
    wss2.on('connection', atenderWs);
    httpsServer.listen(PUERTO_HTTPS, '0.0.0.0', () => {
      console.log(`Pantallas HTTPS: https://0.0.0.0:${PUERTO_HTTPS}  (emisora /emisora.html)`);
    });
  }
} catch (e) {
  console.error('HTTPS no disponible:', e.message);
}

// Limpieza periódica: sesiones zombi (creadas pero sin emisora activa)
// expiran a los 3 min sin movimiento y liberan sus TVs.
setInterval(() => {
  const ahora = Date.now();
  for (const s of [...sesiones.values()]) {
    if (ahora - (s.ultimoMovimiento || 0) > 180000) {
      console.log(`Sesión zombi expirada: ${s.sessionId} (${s.participantes.join(',')})`);
      const muerta = terminarSesion(s.sessionId);
      avisarSesion(muerta, { type: 'stream_stop', sessionId: s.sessionId });
    }
  }
}, 15000);

server.listen(PUERTO, '0.0.0.0', () => {
  console.log(`Pantallas: http://0.0.0.0:${PUERTO}  (panel /, emisora /emisora.html, WS /ws/senalizacion)`);
});
