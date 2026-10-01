// Emisora laptop: captura pantalla (getDisplayMedia) y la envía por WebRTC
// directo a cada TV (diseño B). El servidor solo señaliza (SDP/ICE) por WS.
// Clave embebida del servidor; filtro por laboratorio.
(function () {
    "use strict";
    var ws = null, stream = null;
    var pcs = {};          // deviceId -> RTCPeerConnection
    var sessionId = null;
    var tvsOnline = {};    // deviceId -> {nombre, grupo}
    var pingTimer = null;
    var filtro = localStorage.getItem("pantallas.filtro") || "todas";

    var $ = function (id) { return document.getElementById(id); };
    var CLAVE = "pantallas.apiKey";

    if (!localStorage.getItem(CLAVE) && window.PANTALLAS_API_KEY) {
        localStorage.setItem(CLAVE, window.PANTALLAS_API_KEY);
    }
    $("apiKey").value = localStorage.getItem(CLAVE) || "";
    $("apiKey").onchange = function () { localStorage.setItem(CLAVE, $("apiKey").value.trim()); };

    function wsUrl() {
        return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/senalizacion";
    }

    function conectar() {
        ws = new WebSocket(wsUrl());
        ws.onopen = function () {
            $("estadoWs").textContent = "Señalización: conectada";
            ws.send(JSON.stringify({ type: "hello_emisora" }));
        };
        ws.onclose = function () {
            $("estadoWs").textContent = "Señalización: caída, reintentando…";
            setTimeout(conectar, 3000);
        };
        ws.onmessage = async function (ev) {
            var m;
            try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.type === "tv_list") {
                (m.tvs || []).forEach(function (t) {
                    tvsOnline[t.deviceId] = { nombre: t.nombre || t.deviceId, grupo: t.grupo || "lab1" };
                });
                pintar();
            }
            else if (m.type === "tv_online") {
                tvsOnline[m.deviceId] = { nombre: m.nombre || m.deviceId, grupo: m.grupo || "lab1" };
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
        return Object.keys(set).sort();
    }

    function visibles() {
        return Object.keys(tvsOnline).filter(function (id) {
            return filtro === "todas" || tvsOnline[id].grupo === filtro;
        });
    }

    // Estado real (online/streaming) para no quitarle TVs a otro laboratorio.
    async function actualizarEstados() {
        try {
            var r = await fetch("api/pantallas", { headers: { "X-Api-Key": localStorage.getItem(CLAVE) || "" } });
            if (!r.ok) return;
            var d = await r.json();
            (d.pantallas || []).forEach(function (t) {
                if (tvsOnline[t.deviceId]) tvsOnline[t.deviceId].estado = t.estado;
            });
            pintar();
        } catch (e) { /* sin red, se ignora */ }
    }
    setInterval(actualizarEstados, 8000);

    function pintar() {
        var gs = grupos();
        if (filtro !== "todas" && gs.indexOf(filtro) < 0) filtro = "todas";
        var chips = $("chips");
        chips.innerHTML = "";
        [["todas", "Todas"]].concat(gs.map(function (g) { return [g, g]; })).forEach(function (par) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "tab" + (filtro === par[0] ? " activa" : "");
            b.textContent = par[1];
            b.onclick = function () { filtro = par[0]; localStorage.setItem("pantallas.filtro", filtro); pintar(); };
            chips.appendChild(b);
        });
        var ul = $("tvs"); ul.innerHTML = "";
        var lista = visibles();
        lista.forEach(function (id) {
            var t = tvsOnline[id];
            var li = document.createElement("li");
            var extra = pcs[id] ? " · transmitiendo" : (t.estado === "streaming" ? " · OCUPADA (en sesión)" : "");
            li.textContent = id + " — " + t.nombre + " [" + t.grupo + "]" + extra;
            if (t.estado === "streaming" && !pcs[id]) li.className = "ocupada";
            ul.appendChild(li);
        });
        if (!lista.length) ul.innerHTML = "<li>Sin TVs en este lab con WS abierto.</li>";
    }

    $("btnCapturar").onclick = async function () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            $("info").textContent = "Este navegador bloquea la captura por HTTP. Abre la emisora como http://localhost:8080/emisora.html en el propio servidor, o usa https://TU-IP:8443/emisora.html.";
            return;
        }
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
            $("previa").srcObject = stream;
            $("btnTransmitir").disabled = false;
            $("info").textContent = "Pantalla capturada. Ahora Transmitir.";
        } catch (e) { $("info").textContent = "Captura cancelada."; }
    };

    $("btnTransmitir").onclick = async function () {
        if (!stream) return;
        await actualizarEstados();
        // Si el panel ya creó sesión para estas TVs, se reutiliza (una sola sesión por salón).
        var d;
        try {
            var rr = await fetch("api/pantallas", { headers: { "X-Api-Key": localStorage.getItem(CLAVE) || "" } });
            d = await rr.json();
        } catch (e) { alert("No se alcanzó al servidor."); return; }
        var lista = visibles();
        var existente = (d.sesiones || []).find(function (s) {
            return lista.length && lista.every(function (id) { return (s.participantes || []).indexOf(id) >= 0; });
        });
        if (existente) {
            sessionId = existente.sessionId;
            $("info").textContent = "Usando sesión " + sessionId + " → " + existente.participantes.join(", ");
        } else {
            var libres = lista.filter(function (id) { return tvsOnline[id].estado !== "streaming"; });
            var ocupadas = lista.filter(function (id) { return tvsOnline[id].estado === "streaming"; });
            if (!libres.length) { alert("No hay TVs libres en este lab (todas en sesión). Usa Liberar si es una sesión zombi."); return; }
            var r = await fetch("api/sesiones", {
                method: "POST",
                headers: { "X-Api-Key": localStorage.getItem(CLAVE) || "", "Content-Type": "application/json" },
                body: JSON.stringify({ streamId: "laptop-01", deviceIds: libres })
            });
            if (!r.ok) {
                var err;
                try { err = await r.json(); } catch (x) { err = {}; }
                alert("No se pudo crear sesión: " + (err.detail || r.status));
                return;
            }
            var s = await r.json();
            sessionId = s.sessionId;
            $("info").textContent = "Sesión " + sessionId + " → " + s.participantes.join(", ") +
                ((s.omitidas && s.omitidas.length) ? " (omitidas por ocupadas: " + s.omitidas.join(", ") + ")" : "") +
                (ocupadas.length ? " [en sesión: " + ocupadas.join(", ") + "]" : "");
            lista = s.participantes;
        }
        for (var i = 0; i < lista.length; i++) await llamar(lista[i]);
        iniciarPingSesion();
        $("btnCortar").disabled = false;
        $("btnTransmitir").disabled = true;
    };

    function iniciarPingSesion() {
        detenerPingSesion();
        // Mantiene viva la sesión; si se cierra esta página, el servidor la expira sola.
        pingTimer = setInterval(function () {
            if (ws && ws.readyState === 1 && sessionId)
                ws.send(JSON.stringify({ type: "session_ping", sessionId: sessionId }));
        }, 20000);
    }

    function detenerPingSesion() {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    }

    async function llamar(deviceId) {
        cerrarPc(deviceId);
        var pc = new RTCPeerConnection();
        pcs[deviceId] = pc;
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
        try { await pc.addIceCandidate(JSON.parse(m.candidate)); } catch (e) { /* tardío, ignorar */ }
    }

    function cerrarPc(deviceId) {
        var pc = pcs[deviceId];
        if (pc) { try { pc.close(); } catch (e) {} delete pcs[deviceId]; }
    }

    $("btnCortar").onclick = async function () {
        Object.keys(pcs).forEach(cerrarPc);
        detenerPingSesion();
        if (ws && ws.readyState === 1 && sessionId)
            ws.send(JSON.stringify({ type: "stream_stop", sessionId: sessionId }));
        sessionId = null;
        $("btnCortar").disabled = true;
        $("btnTransmitir").disabled = false;
        $("info").textContent = "Transmisión cortada.";
        pintar();
    };

    $("btnLiberar").onclick = async function () {
        // Mata las sesiones de ESTE lab (zombis incluidas). Pide confirmación.
        var r = await fetch("api/pantallas", { headers: { "X-Api-Key": localStorage.getItem(CLAVE) || "" } });
        var d = await r.json();
        var mias = (d.sesiones || []).filter(function (s) {
            return (s.participantes || []).some(function (id) { return visibles().indexOf(id) >= 0; });
        });
        if (!mias.length) { alert("Este lab no tiene sesiones activas."); return; }
        if (!confirm("Detener " + mias.length + " sesión(es) de este lab?")) return;
        for (var i = 0; i < mias.length; i++) {
            await fetch("api/sesiones/" + encodeURIComponent(mias[i].sessionId), {
                method: "DELETE", headers: { "X-Api-Key": localStorage.getItem(CLAVE) || "" }
            });
        }
        await actualizarEstados();
        $("info").textContent = "Sesiones del lab liberadas.";
    };

    conectar(); pintar();
})();
