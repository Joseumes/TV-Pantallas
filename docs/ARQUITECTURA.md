# Arquitectura del Sistema de Pantallas (UMES)

Documento técnico: cómo está construido el sistema, qué tecnologías usa,
qué dependencias/bibliotecas se importan, cómo funciona el socket y dónde
vive cada recurso.

---

## 1. Visión general

Sistema de señalización **WebRTC** para transmitir la pantalla de una laptop
a un conjunto de televisores Hisense Fire TV en laboratorios. El servidor
**no transporta vídeo**: solo coordina la conexión (SDP/ICE por WebSocket) y
controla sesiones/estado (REST + WebSocket). El vídeo viaja **directo
laptop → TV** por WebRTC dentro de la LAN.

```
┌──────────────┐   HTTP REST + WS    ┌──────────────────┬─► Upstash Redis
│ Panel web    │◄──────────────────►│  Servidor Node    │    (respaldo del
│ (pantallas)  │                     │  (señalización)   │     registro de TVs)
├──────────────┤                     ├──────────────────┤
│ Emisora web  │◄──────────────────►│  Puertos: 8080    ┤    cron-job.org
│ (laptop)     │   HTTP REST + WS    │  8443 (HTTPS opt) │    (ping keep-alive)
└──────┬───────┘                     └──────────────────┘
       │  WebRTC (vídeo directo, no pasa por el servidor)
       ▼
┌───────────────┐     WS señalización (wss://, token por TV)
│ APK Fire TV   │◄──────────────────────────────────────────► Servidor
│ (WebRTC nat.) │
└───────────────┘
```

Tres piezas:

| Pieza | Ruta | Tecnología |
|---|---|---|
| Servidor | `servidor/` | Node.js ≥ 18 (solo stdlib + `ws`) |
| Web | `web/` | HTML/CSS/JS **vanilla** (sin framework) |
| APK TV | `tv-client/` | Kotlin + WebRTC nativo (Android) |
| Instalación/herramientas | `herramientas/` | `.bat` con ADB para instalar la APK en TVs |

---

## 2. Servidor (`servidor/server.js`)

### 2.1 Tecnología

- **Node.js ≥ 18** — un único proceso, sin base de datos local ni framework.
- **Dependencia externa única:** `ws ^8.18.0` (biblioteca WebSocket).
- Módulos nativos de Node importados: `http`, `fs`, `path`, `os`, `crypto`.
- `fetch` global (Node 18+) para el respaldo remoto en Upstash.

```js
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
```

### 2.2 Estado en memoria

| Mapa/Set | Contenido |
|---|---|
| `pantallas` (Map) | deviceId → {nombre, grupo, ip, version, token, ultimoPing, enTransmision} |
| `sesiones` (Map) | sessionId → {streamId, participantes[], creada, ultimoMovimiento} |
| `socketsTv` (Map) | deviceId → WebSocket de esa TV |
| `wsTvInverso` (Map) | ws → deviceId (para limpiar al cerrar) |
| `emisoras` (Set) | WebSockets del panel/emisora conectados a `hello_emisora` |

### 2.3 API REST (autenticación con `X-Api-Key`)

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/salud` | Salud (sin clave): nº pantallas, sesiones, fecha. Lo usa el cron keep-alive |
| GET | `/api/pantallas` | Estado completo: TVs con token/estado/última conexión + sesiones activas + datos de conexión |
| POST | `/api/pantallas` | Pre-registro desde la web; devuelve la **ficha** con token (deviceId 3-32 chars `[A-Z0-9-_]`) |
| PUT | `/api/pantallas/:id` | Editar nombre/grupo (solo la web) |
| DELETE | `/api/pantallas/:id` | Eliminar TV (cierra su WS si está conectada, code 4000) |
| POST | `/api/pantallas/:id/token` | Regenerar token (la TV queda fuera hasta escribir el nuevo) |
| POST | `/api/sesiones` | Crear sesión `{ streamId, deviceIds[] }` → envía `stream_start` a cada TV |
| DELETE | `/api/sesiones/:id` | Terminar sesión → envía `stream_stop` |
| GET | `/config-web.js` | Entrega `window.PANTALLAS_API_KEY="..."` (clave embebida, cero-config para la web) |
| (estático) | `/` | Sirve `web/pantallas.html`, `web/emisora.html`, CSS/JS/íconos |

Reglas clave de sesiones:

- **Una TV = una transmisión**: si llega una sesión con TVs ya en otra
  sesión, esas se *omiten* (HTTP 409 "Todas ocupadas"); nunca un lab le
  "roba" pantallas a otro.
- Cada mensaje `offer`/`answer`/`ice` y `session_ping` mueve
  `ultimoMovimiento`; sin movimiento por **3 min** la sesión "zombi"
  expira y libera sus TVs (sweeper cada **15 s**).

### 2.4 WebSocket de señalización (`/ws/senalizacion`)

Un único WebSocketServer (`ws`-lib) montado sobre el mismo servidor HTTP
(`new WebSocketServer({ server, path: '/ws/senalizacion' })`). Por él NO pasa
vídeo: **solo JSON de control**.

Tipos de mensajes:

| De → A | type | Payload |
|---|---|---|
| TV → S | `register` | deviceId + token (si el token difiere de lo guardado → `error 'token inválido'`) |
| TV → S | `ping` | deviceId (cada **5 s**; sin ping por **20 s** = offline) |
| S → TV | `registered` | deviceId, status, **token nuevo** si se auto-registró |
| S → TV | `pong` | respuesta al ping |
| S → TV | `stream_start` / `stream_stop` | sessionId, streamId |
| S → TV | `offer` / `ice` | sessionId, from, sdp / candidate (para la PC de la laptop) |
| Emisora → S | `hello_emisora` | — (el servidor la agrega al Set de emisoras) |
| S → Emisora | `hello_ok`, `tv_list`, `tv_online`, `tv_offline` | lista/estado en tiempo real de TVs conectadas |
| Emisora → S | `offer` / `answer` / `ice` | `{ toDevice, sessionId, sdp/candidate }` (el servidor reenvía a la TV correcta) |
| Emisora → S | `session_ping` | sessionId, cada 20 s mientras transmite |
| Emisora → S | `stream_stop` | sessionId |

### 2.5 WebRTC (lado web) — en `web/emisora.js`

- Captura: `getDisplayMedia()` (exige HTTPS — por eso existe el modo
  HTTPS/WSS en Render o el server local en 8443).
- Conexión: **una `RTCPeerConnection` por TV** (`pcs[deviceId]`),
  `new RTCPeerConnection()` **sin servidores STUN/TURN** — ambas partes están
  en la misma LAN, así que bastan candidatos `host` (el vídeo nunca cruza
  el servidor).
- Señalización por el mismo WS: `offer` → TV, la TV contesta `answer`/`ice`,
  el servidor reenvía.
- Envía `session_ping` cada 20 s; corta con `stream_stop`.

### 2.6 Persistencia

1. **`servidor/pantallas.json`** (disco): registro completo de TVs
   (`cargar()` al arrancar, `guardar()` en cada cambio; en memoria siempre).
2. **Upstash Redis REST** (opcional, activo con `UPSTASH_REDIS_REST_URL` +
   `UPSTASH_REDIS_REST_TOKEN`): porque en Render free el disco se borra en
   cada reinicio. `restaurarDeRemoto()` (GET `/get/pantallas`) se ejecuta
   **antes de abrir el puerto**; `respaldarRemoto()` (SET con URL-encoded del
   JSON, **debounce 3 s**) dispara tras cada `guardar()`. Uso típico:
   < 20 comandos/día (límite free: 10 000).

### 2.7 Configuración (variables de entorno sobre `config.json`)

| Variable | Uso |
|---|---|
| `PORT` | El que Render inyecta; precede a `PUERTO`/`config.json.puerto` (8080) |
| `API_KEY` | Clave del REST; obligatoria (el proceso aborta sin ella). Va embebida al panel vía `/config-web.js` |
| `RENDER_EXTERNAL_URL` | Al existir, `datosConexion()` entregará `wss://<host>/ws/senalizacion` y las fichas se generan con esa URL |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Respaldo/restauración del registro |
| `NODE_VERSION` | `22` recomendado en Render |
| `config.json`: `pingTimeoutSeg` (20), `https{}` | Local: HTTPS opcional con cert-*.pem (puerto 8443) |

---

## 3. Web (`web/`) — Panel y Emisora

### 3.1 Tecnología

- **Vanilla JS sin framework de build ni bundler** — archivos servidos tal
  cual por el mismo servidor (un solo origen; sin CORS).
- Animación/UI: **GSAP** (`gsap.min.js`, `ScrollTrigger.min.js`,
  `SplitText.min.js`) y **Lenis** (`lenis.min.js`, scroll suave) — vendored
  en `web/vendor/`, sin CDN.
- Tipografía **Jost** (`jost.woff2` vendored), CSS propio (`estilos.css`).
- Comunicación: `fetch()` para REST y un **WebSocket** a
  `(ws|wss)://<host>/ws/senalizacion` (elige el esquema según
  `location.protocol`).

### 3.2 Archivos

| Archivo | Rol |
|---|---|
| `pantallas.html` / `pantallas.js` | Panel operador: home de labs, vista por lab con tarjetas, fichas copiables (Servidor/Puerto/Código/Token), alta/edición/borrado de TVs |
| `emisora.html` / `emisora.js` | Emisora: chips de laboratorio, "Compartir pantalla", vista previa, tally/reloj en vivo |
| `ui.js` | Biblioteca UI compartida (toasts, teclado, animaciones GSAP) |
| `tv-sim.html` | Simulador de TV en navegador (para probar sin Fire TV) |
| `config-web.js` | **Generado por el servidor**: `window.PANTALLAS_API_KEY="..."` |

La clave de API es **cero-config**: el navegador la recibe embebida del
servidor y la aplica solo al cargar; no hay campo visible para el usuario.

---

## 4. APK Fire TV (`tv-client/`)

### 4.1 Tecnología y dependencias (`app/build.gradle`)

- **Kotlin** (JVM target **17**), Android, `minSdk 22` / `targetSdk 30`
  (probado en Fire OS 8 de Hisense 55QD7QF), `applicationId
  com.universidad.pantallas`.
- `androidx.core:core-ktx:1.13.1`, `androidx.appcompat:appcompat:1.7.0`
- **WebSocket:** `com.squareup.okhttp3:okhttp:4.12.0` —
  `Request.Builder().url(device.wsUrl)`; soporta `ws://` (LAN) y `wss://`
  (Render) transparentemente.
- **WebRTC nativo:** `io.github.webrtc-sdk:android:125.6422.06.1`
  (build verificado de Maven Central — el `com.infobip:google-webrtc`
  usa PeerConnectionFactory roto y el `org.webrtc:google-webrtc`
  heredado murió junto con JCenter).
- Sin librería leanback (solo `LEANBACK_LAUNCHER` en el manifiesto).

### 4.2 Clases principales

| Archivo | Rol |
|---|---|
| `SignalingClient.kt` | WebSocket con reconexión automática y pings de 5 s |
| `WebRtcReceiver.kt` | `PeerConnectionFactory`; recibe el `VideoTrack` vía `VideoSink` y lo pinta en `SurfaceViewRenderer` |
| `DeviceManager.kt` | Config persistente en SharedPreferences: servidor (IP **o** URL completa `wss://...`), deviceId, token; `wsUrl` arma `ws://ip:puerto/ws/senalizacion` o usa la URL tal cual |
| `NetworkMonitor.kt` | Detecta caída de red y dispara reconexión del WS |
| `MainActivity.kt` | UI a pantalla completa, espera/espera "Ofrecer"…, render del vídeo |
| `ConfigActivity.kt` | Formulario Config (servidor, código, nombre, token) |
| `RegistroLocal.kt` | Registro local de eventos en el filesystem de la TV |
| `TvApplication.kt` | Inicializa la PeerConnectionFactory global |

Importes WebRTC nativos en uso: `PeerConnectionFactory`, `PeerConnection`,
`SessionDescription`, `IceCandidate`, `MediaStream`, `MediaConstraints`,
`DefaultVideoDecoderFactory`, `EglBase`, `SurfaceViewRenderer`,
`RendererCommon`, `DataChannel`, `JavaAudioDeviceModule`.

### 4.3 Flujo de recepción del vídeo en la TV

1. Conecta `wss(s)://servidor/ws/senalizacion` y envía `register` (deviceId + token).
2. Pide Recepción de señalización: escucha `offer` → crea
   `RTCPeerConnection` → responde `answer` → recibe `ice`.
3. Recibe `VideoTrack` por el `peerConnection` y lo renderiza fullscreen.

---

## 5. Recursos / capacidades / límites

### 5.1 Recursos del servidor en la nube (Render free)

- 1 instancia: 512 MB RAM, 0.1 CPU, 750 h/mes (`≈` 1 servicio 24/7),
  5 GB de ancho de banda/mes, WebSockets soportados (cuentan como
  actividad), **sin disco persistente** (solucionado con Upstash),
  spin-down tras 15 min sin tráfico (mitigado con cron-job.org pinging
  `/api/salud` cada 5 min).
- Con ~10 sesiones simultáneas la carga sería ~10 mensajes/s de JSON de
  señalización (1-2 KB cada uno) — trivial para esa instancia.
- Uso real medible: < 20 comandos/día en Upstash, ~decenas de MB/mes de
  banda de señalización — margen enorme contra los límites free.

### 5.2 ¿Cuántos dispositivos pueden transmitir a la vez? (10 laptops)

**No hay límite "de software" por diseño**: cada sesión es independiente
por salón. 10 laptops diferentes compartiendo rooms distintas **es un caso
de uso soportado**: cada una crea su propia sesión (`streamId` distinto), y
el servidor nunca pone una TV en dos sesiones a la vez.

Límites prácticos:

| Cota | Valor | Comentario |
|---|---|---|
| Servidor de señalización | (~) cientos de sesiones simultáneas | 0.1 CPU sobra; cada sesión es solo SDP/ICE + JSON |
| Instancias free Render | 1 | (no se puede escalar horizontal sin pagar) |
| **LAN del campus (el cuello real de botella)** | ~5 Mbps por TV | 10 laptops × 2 TVs = 20 contratos concurrentes ≈ 100 Mbps de multicast; si cada stream sube 5 Mbps, la card red es quien manda — usar cable |
| TV | 1 sesión | una TV no recibe de dos laptops a la vez (por diseño) |

El límite real a vigilar **no es el servidor sino la red del campus**: el
tráfico de vídeo consume ~5 Mbps por TV desde la laptop emisora. 10 laptops
× 4 TVs cada una = 40 streams simultáneos ≈ 200 Mbps de tráfico en la LAN.
Cada salón se portaría como una isla (cada laptop solo carga su propia
cadena piso→switch→TVs), así que 10 salones lo absorben; evita que las TVs
y las laptops emisóricas compartan el mismo tramo de switch/SWi-Fi.

### 5.3 Dependencias / versiones en resumen

| Componente | Paquete | Versión |
|---|---|---|
| Servidor | `ws` | ^8.18.0 |
| Servidor | Node.js | ≥ 18 (22 en producción) |
| Web | GSAP / ScrollTrigger / SplitText / Lenis | vendored (sin versión npm) |
| APK | `okhttp` | 4.12.0 |
| APK | `androidx.core-ktx` | 1.13.1 |
| APK | `androidx.appcompat` | 1.7.0 |
| APK | `webrtc-sdk:android` | 125.6422.06.1 |

## 6. Seguridad

- **REST:** header `X-Api-Key`; sin la clave → HTTP 401. `/api/salud` es la
  única ruta abierta (para el cron).
- **WS:** **sin API Key**; la TV se autentica con su **token individual**
  (16 bytes hex por TV). Si el token difiere al `register` → rechazo.
- **Web embebida:** la clave viaja en `/config-web.js` (diseño original de
  "red cerrada"); es visible para quien abra el inspector — asumido a
  propósito para este contexto. La TV nunca usa esa clave.
- **Upstash:** token solo en variables de entorno (nunca en el repo).
