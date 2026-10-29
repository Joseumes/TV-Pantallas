// Emisora laptop: una card por laboratorio.
// En cada card hay un botón "Compartir pantalla" que captura (getDisplayMedia)
// y transmite DIRECTO a las TVs de ese laboratorio, sin selector previo.
// El servidor solo señaliza (SDP/ICE) por WS. El vídeo va por WebRTC laptop->TV.
(function () {
    "use strict";
    var ws = null, stream = null;
    var pcs = {};            // deviceId -> RTCPeerConnection
    var sesionesPorLab = {}; // grupo -> sessionId (creadas por esta página)
    var tvsOnline = {};      // deviceId -> {nombre, grupo, estado}
    var sesionesServidor = [];// últimas sesiones vistas en /api/pantallas
    var pingTimer = null;

    var $ = function (id) { return document.getElementById(id); };
    var CLAVE = "pantallas.apiKey";

    // Clave cero-config: el servidor entrega siempre la vigente embebida en
    // config-web.js y se impone al abrir la página (si cambia en el servidor,
    // el navegador se autocorrige al recargar). No hay nada que pegar.
    if (window.PANTALLAS_API_KEY) {
        localStorage.setItem(CLAVE, window.PANTALLAS_API_KEY);
    }

    function wsUrl() {
        return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/senalizacion";
    }
    function clave() { return localStorage.getItem(CLAVE) || window.PANTALLAS_API_KEY || ""; }
    function conAudio() {
        // Interruptor "Compartir también el audio". Por defecto activado.
        var c = $("chkAudio");
        return c ? c.checked : true;
    }
    function tieneAudio() {
        return !!(stream && stream.getAudioTracks().some(function (t) { return t.readyState === "live"; }));
    }

    //--- Presentación: chip, luz de aire y reloj ------------------------------
    function estadoWs(texto, ok) {
        $("estadoWs").textContent = texto;
        $("wsChip").classList.toggle("ok", ok === true);
        $("wsChip").classList.toggle("mal", ok === false);
    }
    var relojTimer = null, relojInicio = 0;
    function emision(modo) {
        document.body.dataset.emision = modo;
        var pant = document.querySelector(".pantalla-previa");
        if (modo === "aire" && UI) UI.cuentaRegresiva(pant);
        else if (modo === "capturada" && UI) UI.encenderPantalla(pant);
        else if (modo !== "aire" && UI) UI.glitch(pant);
        if (UI) UI.osd({ idle: "Sin pantalla compartida", capturada: "Vista previa lista", aire: "● En vivo" }[modo]);
        $("tallyTxt").textContent = { idle: "Sin pantalla compartida", capturada: "Vista previa lista", aire: "En vivo" }[modo];
        clearInterval(relojTimer);
        if (modo === "aire") {
            relojInicio = Date.now();
            relojTimer = setInterval(function () {
                var s = Math.floor((Date.now() - relojInicio) / 1000);
                $("reloj").textContent = [s / 3600, (s % 3600) / 60, s % 60].map(function (n) {
                    return String(Math.floor(n)).padStart(2, "0");
                }).join(":");
            }, 1000);
        } else $("reloj").textContent = "00:00:00";
    }
    function refrescarEmision() {
        var hayTx = Object.keys(pcs).length > 0;
        emision(!stream ? "idle" : (hayTx ? "aire" : "capturada"));
        $("btnCortarTodo").disabled = !hayTx && !Object.keys(sesionesPorLab).length;
    }

    //--- Señalización ----------------------------------------------------------
    function conectar() {
        ws = new WebSocket(wsUrl());
        ws.onopen = function () {
            estadoWs("Sistema conectado", true);
            ws.send(JSON.stringify({ type: "hello_emisora" }));
        };
        ws.onclose = function () {
            estadoWs("Sin conexión, reintentando…", false);
            setTimeout(conectar, 3000);
        };
        ws.onmessage = async function (ev) {
            var m;
            try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.type === "tv_list") {
                (m.tvs || []).forEach(function (t) {
                    tvsOnline[t.deviceId] = {
                        nombre: t.nombre || t.deviceId, grupo: t.grupo || "lab1",
                        estado: (tvsOnline[t.deviceId] && tvsOnline[t.deviceId].estado) || "online"
                    };
                });
                pintar();
            }
            else if (m.type === "tv_online") {
                tvsOnline[m.deviceId] = {
                    nombre: m.nombre || m.deviceId, grupo: m.grupo || "lab1",
                    estado: (tvsOnline[m.deviceId] && tvsOnline[m.deviceId].estado) || "online"
                };
                pintar();
            }
            else if (m.type === "tv_offline") { delete tvsOnline[m.deviceId]; pintar(); }
            else if (m.type === "answer") { await alRecibirAnswer(m); }
            else if (m.type === "ice") { await alRecibirIce(m); }
        };
    }

    function grupos() {
        var set = {};
        Object.keys(tvsOnline).forEach(function (id) { set[tvsOnline[id].grupo] = true; });
        // También incluye labs que el servidor conoce aunque sus TVs estén apagadas,
        // para que la card no desaparezca al apagarse todo el salón.
        ultimasConocidas.forEach(function (t) { set[t.grupo || "lab1"] = true; });
        return Object.keys(set).sort();
    }
    var ultimasConocidas = [];

    // Estado real (online/streaming/offline) desde la API.
    async function actualizarEstados() {
        try {
            var r = await fetch("api/pantallas", { headers: { "X-Api-Key": clave() } });
            if (!r.ok) return;
            var d = await r.json();
            sesionesServidor = d.sesiones || [];
            ultimasConocidas = (d.pantallas || []).map(function (t) {
                return { deviceId: t.deviceId, nombre: t.nombre, grupo: t.grupo || "lab1", estado: t.estado };
            });
            // Marca estado de las online; las offline del WS se conservan para la card.
            (d.pantallas || []).forEach(function (t) {
                if (tvsOnline[t.deviceId]) {
                    tvsOnline[t.deviceId].estado = t.estado;
                    tvsOnline[t.deviceId].nombre = t.nombre || tvsOnline[t.deviceId].nombre;
                    tvsOnline[t.deviceId].grupo = t.grupo || tvsOnline[t.deviceId].grupo;
                }
            });
            // Limpia sesiones nuestras que el servidor ya no tiene (expiradas/borradas).
            Object.keys(sesionesPorLab).forEach(function (lab) {
                var sid = sesionesPorLab[lab];
                var sigue = sesionesServidor.some(function (s) { return s.sessionId === sid; });
                if (!sigue) {
                    // Si ya no existe en servidor, suelta sus PCs.
                    Object.keys(pcs).forEach(function (id) {
                        if (tvsOnline[id] && tvsOnline[id].grupo === lab) cerrarPc(id);
                    });
                    delete sesionesPorLab[lab];
                }
            });
            pintar();
            refrescarEmision();
        } catch (e) { /* sin red, se ignora */ }
    }
    setInterval(actualizarEstados, 8000);

    function tvsDeLab(lab) {
        return Object.keys(tvsOnline).filter(function (id) { return tvsOnline[id].grupo === lab; });
    }
    function sesionAjenaEnLab(lab) {
        // Sesión del servidor que ocupa este lab y NO es nuestra.
        var mias = {};
        Object.keys(sesionesPorLab).forEach(function (k) { mias[sesionesPorLab[k]] = true; });
        return sesionesServidor.filter(function (s) {
            if (mias[s.sessionId]) return false;
            return (s.participantes || []).some(function (id) {
                return tvsOnline[id] && tvsOnline[id].grupo === lab;
            });
        });
    }
    function estoyTransmitiendoLab(lab) {
        return tvsDeLab(lab).some(function (id) { return !!pcs[id]; });
    }
    function labEnVivo() {
        // Lab que esta página está transmitiendo ahora (si hay varios, el primero).
        var labs = Object.keys(sesionesPorLab);
        if (labs.length) return labs[0];
        var gs = grupos();
        for (var i = 0; i < gs.length; i++) {
            if (estoyTransmitiendoLab(gs[i])) return gs[i];
        }
        return null;
    }

    //--- Pintar cards -----------------------------------------------------------
    function pintar() {
        var box = $("labCards");
        if (!box) return;
        box.innerHTML = "";
        var gs = grupos();
        if (!gs.length) {
            box.innerHTML = "<div class='vacio'>No hay televisiones encendidas. Enciende las TVs y abre la aplicación: aparecerán aquí solas por laboratorio.</div>";
            return;
        }
        gs.forEach(function (g, i) {
            var ids = tvsDeLab(g);
            var on = ids.filter(function (id) { return tvsOnline[id].estado === "online"; }).length;
            var st = ids.filter(function (id) { return tvsOnline[id].estado === "streaming" || pcs[id]; }).length;
            var off = ids.length - on - st;
            if (off < 0) off = 0;
            var transmitiendo = estoyTransmitiendoLab(g);
            var ajenas = sesionAjenaEnLab(g);
            // Bloqueo: si esta página ya transmite a OTRO lab, esta card queda
            // bloqueada hasta pulsar "Terminar transmisión" en la card activa.
            var activo = labEnVivo();
            var bloqueadaPorOtra = !!activo && activo !== g && !transmitiendo;

            var card = document.createElement("article");
            card.className = "lab-card tarjeta spot emi-card" + (transmitiendo ? " en-vivo bloqueada" : "") + (bloqueadaPorOtra ? " bloqueada-ajena" : "");
            if (transmitiendo) card.setAttribute("aria-disabled", "true");
            card.innerHTML =
                "<span class='idx'>CANAL " + String(i + 1).padStart(2, "0") + "</span>" +
                "<div><h3></h3>" +
                "<div class='puntos'>" + ids.map(function (id) {
                    var t = tvsOnline[id];
                    var cls = pcs[id] ? "streaming" : (t.estado === "streaming" ? "streaming" : (t.estado === "online" ? "online" : "offline"));
                    return "<i class='" + cls + "' title='" + id + " · " + t.nombre + "'></i>";
                }).join("") + "</div>" +
                "<ul class='emi-tvs'></ul></div>" +
                "<div class='lab-pie'><div class='lab-stats'>" +
                "<span><b>" + ids.length + "</b>" + (ids.length === 1 ? "TV" : "TVs") + "</span>" +
                "<span><b class='on'>" + on + "</b>" + (on === 1 ? "lista" : "listas") + "</span>" +
                "<span><b class='st'>" + st + "</b>en vivo</span>" +
                "</div><span class='lab-ir'></span></div>" +
                "<div class='emi-acciones'></div>";
            card.querySelector("h3").textContent = g;
            card.querySelector(".lab-ir").textContent = transmitiendo ? "● En vivo · bloqueada" : (bloqueadaPorOtra ? "Bloqueada · hay transmisión en " + activo : (ids.length ? ids.length + " pantalla" + (ids.length === 1 ? "" : "s") : "Sin TVs"));
            var ul = card.querySelector(".emi-tvs");
            if (!ids.length) {
                ul.innerHTML = "<li class='vacia'>TVs apagadas en este laboratorio.</li>";
            } else {
                ids.forEach(function (id) {
                    var t = tvsOnline[id];
                    var li = document.createElement("li");
                    var enlazada = pcs[id] && pcs[id].connectionState === "connected";
                    var ocupada = t.estado === "streaming" && !pcs[id];
                    var tag = pcs[id] ? (enlazada ? "En vivo" : "Conectando…") : (ocupada ? "Ocupada" : (t.estado === "online" ? "Lista" : "Apagada"));
                    li.className = pcs[id] ? ("tx" + (enlazada ? "" : " enlazando")) : (ocupada ? "ocupada" : "");
                    li.innerHTML = "<span class='dot " + (pcs[id] ? "streaming" : ocupada ? "offline" : (t.estado === "online" ? "online" : "offline")) + "'></span>" +
                        "<span><span class='n'></span><span class='c'></span></span><span class='tag'></span>";
                    li.querySelector(".n").textContent = t.nombre;
                    li.querySelector(".c").textContent = id;
                    li.querySelector(".tag").textContent = tag;
                    ul.appendChild(li);
                });
            }

            var acc = card.querySelector(".emi-acciones");
            var btn = document.createElement("button");
            btn.type = "button";
            if (transmitiendo) {
                btn.className = "peligro";
                btn.textContent = "Apagar transmisión";
                btn.title = "Detiene la transmisión de " + g + " y libera la tarjeta";
                btn.onclick = function () { terminarLab(g); };
                // Aviso de bloqueo dentro de la card activa.
                var cand = document.createElement("p");
                cand.className = "bloqueo-msg";
                cand.textContent = "🔒 Transmitiendo: tarjeta bloqueada hasta apagar la transmisión.";
                acc.appendChild(cand);
            } else {
                btn.textContent = ids.length ? "Compartir pantalla a este laboratorio →" : "Sin pantallas encendidas";
                btn.disabled = !ids.length || bloqueadaPorOtra;
                if (bloqueadaPorOtra) {
                    btn.title = "Termina la transmisión de " + activo + " para usar este laboratorio.";
                }
                btn.onclick = function () { compartirLab(g); };
            }
            acc.appendChild(btn);
            if (bloqueadaPorOtra) {
                var aviso = document.createElement("p");
                aviso.className = "bloqueo-msg";
                aviso.textContent = "🔒 Bloqueada: hay transmisión en curso en " + activo + ". Apágala para usar esta tarjeta.";
                acc.appendChild(aviso);
            }
            if (ajenas.length && !transmitiendo) {
                var lib = document.createElement("button");
                lib.type = "button";
                lib.className = "fantasma";
                lib.textContent = "¿Ocupadas? Liberar " + g;
                lib.onclick = function () { liberarLab(g); };
                acc.appendChild(lib);
            }
            if (window.UI) UI.magnetico(btn, .18);
            box.appendChild(card);
        });
        if (window.UI) UI.entrada(box.children, { y: 0, scale: .97, paso: .05, duracion: .6 });
        var cuenta = Object.keys(pcs).length;
        $("btnCortarTodo").disabled = !cuenta && !Object.keys(sesionesPorLab).length;
    }

    //--- Captura (una sola vez, se reutiliza para varios labs) ------------------
    async function asegurarStream() {
        if (stream) {
            var vivas = stream.getVideoTracks().filter(function (t) { return t.readyState === "live"; });
            if (vivas.length) return stream;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            $("info").textContent = "Este navegador bloquea la captura por HTTP. Abre la emisora en el propio servidor como http://localhost:8080/emisora.html, o usa https://TU-IP:8443/emisora.html.";
            throw new Error("sin-captura");
        }
        // audio:true pide el audio del sistema/pestaña. El navegador muestra su
        // casilla "Compartir audio": hay que marcarla y compartir una pestaña
        // (pantalla completa a veces no trae audio según el navegador).
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: conAudio() ? true : false });
        $("previa").srcObject = stream;
        $("previa").muted = true; // la vista previa siempre muda (evita acople aquí).
        // Si el usuario deja de compartir desde el navegador, se cortan los enlaces pero
        // las sesiones se liberan en el servidor.
        stream.getVideoTracks().forEach(function (tr) {
            tr.onended = function () {
                $("info").textContent = "Dejaste de compartir tu pantalla. Las transmisiones se detuvieron.";
                terminarTodo(false);
            };
        });
        if (tieneAudio()) {
            $("info").textContent = "Vista previa lista CON audio. Conectando con las TVs…";
        } else if (conAudio()) {
            $("info").textContent = "Vista previa lista SIN audio: vuelve a compartir eligiendo una pestaña y marcando «Compartir audio» en la ventana del navegador.";
            UI.toast("Sin pista de audio: comparte una pestaña y marca «Compartir audio».", "aviso");
        } else {
            $("info").textContent = "Vista previa lista (sin audio, interruptor apagado). Conectando con las TVs…";
        }
        refrescarEmision();
        return stream;
    }
    if ($("chkAudio")) {
        $("chkAudio").onchange = function () {
            // El cambio aplica en la próxima vez que se comparta (el stream
            // activo no puede ganar audio sin volver a pedirlo al navegador).
            if (stream && stream.getVideoTracks().some(function (t) { return t.readyState === "live"; })) {
                UI.toast("El cambio de audio aplica cuando vuelvas a compartir (apaga y comparte de nuevo).", "aviso");
            }
        };
    }

    //--- Transmitir a UN laboratorio desde su card -------------------------------
    async function compartirLab(lab) {
        // Bloqueo: no se puede compartir a otro lab mientras uno está en vivo,
        // ni re-compartir al mismo sin apagar antes.
        var activo = labEnVivo();
        if (activo && activo !== lab) {
            UI.toast("La tarjeta está bloqueada: termina la transmisión de " + activo + " para usar " + lab + ".", "aviso");
            return;
        }
        if (activo === lab || estoyTransmitiendoLab(lab)) {
            UI.toast(lab + " ya está transmitiendo. Pulsa «Apagar transmisión» para liberarla.", "aviso");
            return;
        }
        try { await asegurarStream(); }
        catch (e) {
            if (e && e.message !== "sin-captura") $("info").textContent = "No se compartió la pantalla. Pulsa de nuevo «Compartir pantalla» en la tarjeta del laboratorio.";
            return;
        }
        await actualizarEstados();
        var ids = tvsDeLab(lab);
        if (!ids.length) { UI.toast("No hay TVs encendidas en " + lab + ".", "aviso"); return; }

        // ¿Ya hay sesión nuestra para este lab? Se reutiliza.
        var sessionId = sesionesPorLab[lab] || null;
        if (sessionId) {
            var sigue = sesionesServidor.some(function (s) { return s.sessionId === sessionId; });
            if (!sigue) { sessionId = null; delete sesionesPorLab[lab]; }
        }
        // ¿Alguien preparó sesión desde Inicio (pantallas.html) para este lab? Reutilizarla.
        if (!sessionId) {
            var preparada = sesionesServidor.find(function (s) {
                return (s.participantes || []).length &&
                    (s.participantes || []).every(function (id) { return tvsOnline[id] && tvsOnline[id].grupo === lab; });
            });
            if (preparada) {
                sessionId = preparada.sessionId;
                sesionesPorLab[lab] = sessionId;
            }
        }
        if (!sessionId) {
            var d;
            try {
                var rr = await fetch("api/pantallas", { headers: { "X-Api-Key": clave() } });
                d = await rr.json();
                sesionesServidor = d.sesiones || [];
            } catch (e) { UI.toast("No se alcanzó al servidor.", "error"); return; }
            var libres = ids.filter(function (id) {
                var t = (d.pantallas || []).find(function (x) { return x.deviceId === id; });
                return !t || t.estado !== "streaming" || pcs[id];
            });
            if (!libres.length) { UI.toast("Todas las TVs de " + lab + " están ocupadas. Usa «Liberar " + lab + "» si es una sesión anterior.", "aviso"); return; }
            var r = await fetch("api/sesiones", {
                method: "POST",
                headers: { "X-Api-Key": clave(), "Content-Type": "application/json" },
                body: JSON.stringify({ streamId: "laptop-01", deviceIds: libres })
            });
            if (!r.ok) {
                var err;
                try { err = await r.json(); } catch (x) { err = {}; }
                UI.toast("No se pudo crear sesión: " + (err.detail || r.status), "error");
                return;
            }
            var s = await r.json();
            sessionId = s.sessionId;
            sesionesPorLab[lab] = sessionId;
            ids = s.participantes && s.participantes.length ? s.participantes : libres;
            $("info").textContent = "Sesión " + sessionId + " en " + lab + " → " + ids.join(", ") +
                ((s.omitidas && s.omitidas.length) ? " (omitidas por ocupadas: " + s.omitidas.join(", ") + ")" : "");
        } else {
            $("info").textContent = "Usando sesión " + sessionId + " en " + lab + " → " + ids.join(", ");
        }
        for (var i = 0; i < ids.length; i++) await llamar(ids[i], sessionId);
        iniciarPingSesion();
        refrescarEmision();
        pintar();
        UI.toast("Transmitiendo a " + lab + " (" + ids.length + " pantalla" + (ids.length === 1 ? "" : "s") + (tieneAudio() ? ", con audio" : ", sin audio") + ").", "ok");
    }

    async function terminarLab(lab) {
        var sid = sesionesPorLab[lab];
        tvsDeLab(lab).forEach(cerrarPc);
        if (sid) {
            if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "stream_stop", sessionId: sid }));
            try {
                await fetch("api/sesiones/" + encodeURIComponent(sid), {
                    method: "DELETE", headers: { "X-Api-Key": clave() }
                });
            } catch (e) {}
            delete sesionesPorLab[lab];
        }
        await actualizarEstados();
        $("info").textContent = "Transmisión de " + lab + " terminada. Sus pantallas quedaron libres.";
        refrescarEmision();
        pintar();
    }

    async function terminarTodo(avisar) {
        Object.keys(pcs).forEach(cerrarPc);
        detenerPingSesion();
        var sids = Object.keys(sesionesPorLab).map(function (k) { return sesionesPorLab[k]; });
        sesionesPorLab = {};
        sids.forEach(function (sid) {
            if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "stream_stop", sessionId: sid }));
        });
        for (var i = 0; i < sids.length; i++) {
            try {
                await fetch("api/sesiones/" + encodeURIComponent(sids[i]), {
                    method: "DELETE", headers: { "X-Api-Key": clave() }
                });
            } catch (e) {}
        }
        if (avisar !== false) $("info").textContent = "Todas las transmisiones terminaron. Las pantallas quedaron libres.";
        await actualizarEstados();
        refrescarEmision();
        pintar();
    }

    async function liberarLab(lab) {
        await actualizarEstados();
        var mias = sesionesServidor.filter(function (s) {
            return (s.participantes || []).some(function (id) { return tvsOnline[id] && tvsOnline[id].grupo === lab; });
        });
        if (!mias.length) { UI.toast("Las pantallas de " + lab + " ya están libres.", "ok"); return; }
        if (!(await UI.confirmar({
            titulo: "¿Liberar las pantallas de " + lab + "?",
            texto: "Se detendrá la transmisión que las ocupa. Úsalo si quedaron ocupadas por una clase anterior.",
            ok: "Sí, liberar", peligro: true
        }))) return;
        for (var i = 0; i < mias.length; i++) {
            try {
                await fetch("api/sesiones/" + encodeURIComponent(mias[i].sessionId), {
                    method: "DELETE", headers: { "X-Api-Key": clave() }
                });
            } catch (e) {}
            // Si era nuestra, suelta sus PCs también.
            Object.keys(sesionesPorLab).forEach(function (k) {
                if (sesionesPorLab[k] === mias[i].sessionId) {
                    tvsDeLab(k).forEach(cerrarPc);
                    delete sesionesPorLab[k];
                }
            });
        }
        await actualizarEstados();
        $("info").textContent = "Listo: las pantallas de " + lab + " quedaron libres.";
        refrescarEmision();
        pintar();
    }

    function iniciarPingSesion() {
        detenerPingSesion();
        pingTimer = setInterval(function () {
            if (ws && ws.readyState === 1) {
                Object.keys(sesionesPorLab).forEach(function (lab) {
                    ws.send(JSON.stringify({ type: "session_ping", sessionId: sesionesPorLab[lab] }));
                });
            }
        }, 20000);
    }
    function detenerPingSesion() {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    }

    async function llamar(deviceId, sessionId) {
        cerrarPc(deviceId);
        var pc = new RTCPeerConnection();
        pcs[deviceId] = pc;
        pc.addEventListener("connectionstatechange", function () { pintar(); refrescarEmision(); });
        stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
        pc.onicecandidate = function (ev) {
            if (ev.candidate && ws && ws.readyState === 1)
                ws.send(JSON.stringify({ type: "ice", sessionId: sessionId, toDevice: deviceId, candidate: JSON.stringify(ev.candidate) }));
        };
        var offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", sessionId: sessionId, toDevice: deviceId, sdp: offer.sdp }));
        pintar();
    }

    async function alRecibirAnswer(m) {
        var pc = pcs[m.from];
        if (!pc) return;
        await pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
    }
    async function alRecibirIce(m) {
        var pc = pcs[m.from];
        if (!pc || !m.candidate) return;
        try { await pc.addIceCandidate(JSON.parse(m.candidate)); } catch (e) {}
    }
    function cerrarPc(deviceId) {
        var pc = pcs[deviceId];
        if (pc) { try { pc.close(); } catch (e) {} delete pcs[deviceId]; }
    }

    $("btnCortarTodo").onclick = function () { terminarTodo(true); };

    conectar();
    actualizarEstados();
    pintar();
    refrescarEmision();

    UI.titular($("titular"), .2);
    UI.entrada(".escenario", { delay: .35, y: 50 });
    UI.ruido($("ruidoPrevia"), function () { return document.body.dataset.emision === "idle"; });
})();
