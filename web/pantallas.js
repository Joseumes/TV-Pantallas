// Panel operador: home de laboratorios + vista por lab + sesiones.
// Varios labs pueden transmitir a la vez (sesiones independientes por lab).
// La API Key viene embebida del servidor (config-web.js); el campo manual la sobreescribe.
(function () {
    "use strict";
    var CLAVE = "pantallas.apiKey";
    var sel = new Set();
    var servidor = {};
    var ultimasTvs = [], ultimasSesiones = [];
    var vista = "home", labActual = localStorage.getItem("pantallas.lab") || null;

    function clave() {
        return localStorage.getItem(CLAVE) || window.PANTALLAS_API_KEY || "";
    }
    function hdr() { return { "X-Api-Key": clave(), "Content-Type": "application/json" }; }

    if (!localStorage.getItem(CLAVE) && window.PANTALLAS_API_KEY) {
        localStorage.setItem(CLAVE, window.PANTALLAS_API_KEY);
    }
    document.getElementById("apiKey").value = clave();
    document.getElementById("btnGuardarClave").onclick = function () {
        localStorage.setItem(CLAVE, document.getElementById("apiKey").value.trim());
        cargar();
    };

    function grupoDe(t) { return t.grupo || "lab1"; }

    function grupos() {
        var set = {};
        ultimasTvs.forEach(function (t) { set[grupoDe(t)] = true; });
        return Object.keys(set).sort();
    }

    function enLab(sesion, lab) {
        return (sesion.participantes || []).some(function (id) {
            var t = ultimasTvs.find(function (x) { return x.deviceId === id; });
            return t && grupoDe(t) === lab;
        });
    }

    async function cargar() {
        var r = await fetch("api/pantallas", { headers: { "X-Api-Key": clave() } });
        if (!r.ok) {
            document.getElementById("labCards").textContent = "Error " + r.status + " (¿API Key?).";
            return;
        }
        var d = await r.json();
        servidor = d.servidor || {};
        ultimasTvs = d.pantallas || [];
        ultimasSesiones = d.sesiones || [];
        pintar();
    }

    function pintar() {
        document.getElementById("vistaHome").classList.toggle("oculto", vista !== "home");
        document.getElementById("vistaLab").classList.toggle("oculto", vista !== "lab");
        if (vista === "home") pintarHome();
        else pintarLab();
    }

    //--- Home ----------------------------------------------------------------
    function pintarHome() {
        var box = document.getElementById("labCards");
        box.innerHTML = "";
        var gs = grupos();
        var dl = document.getElementById("gruposExistentes");
        dl.innerHTML = "";
        gs.forEach(function (g) {
            var o = document.createElement("option");
            o.value = g;
            dl.appendChild(o);
        });
        [["todas", "Todas las TVs"]].concat(gs.map(function (g) { return [g, g]; })).forEach(function (par) {
            var tvs = par[0] === "todas" ? ultimasTvs : ultimasTvs.filter(function (t) { return grupoDe(t) === par[0]; });
            var on = tvs.filter(function (t) { return t.estado === "online"; }).length;
            var st = tvs.filter(function (t) { return t.estado === "streaming"; }).length;
            var off = tvs.length - on - st;
            var card = document.createElement("div");
            card.className = "lab-card";
            card.innerHTML = "<h3></h3><div class='lab-stats'></div>";
            card.querySelector("h3").textContent = par[1];
            card.querySelector(".lab-stats").innerHTML =
                tvs.length + " TVs · <b class='on'>" + on + " en línea</b> · " +
                "<b class='st'>" + st + " transmitiendo</b> · <b class='off'>" + off + " fuera</b>";
            card.onclick = function () {
                vista = "lab"; labActual = par[0];
                localStorage.setItem("pantallas.lab", labActual);
                sel.clear();
                pintar();
            };
            box.appendChild(card);
        });
        if (!gs.length) box.innerHTML = "<p>Sin TVs. Agrega la primera abajo.</p>";
    }

    //--- Vista lab ------------------------------------------------------------
    function tvsLab() {
        if (labActual === "todas") return ultimasTvs.slice();
        return ultimasTvs.filter(function (t) { return grupoDe(t) === labActual; });
    }

    function sesionDelLab() {
        var candidatas = ultimasSesiones.filter(function (s) {
            if (labActual === "todas") return true;
            return enLab(s, labActual);
        });
        return candidatas.length ? candidatas[candidatas.length - 1] : null;
    }

    function pintarLab() {
        document.getElementById("labTitulo").textContent = labActual === "todas" ? "Todas las TVs" : labActual;
        var box = document.getElementById("lista");
        box.innerHTML = "";
        tvsLab().forEach(function (t) {
            var div = document.createElement("div");
            div.className = "tv" + (sel.has(t.deviceId) ? " sel" : "");
            var cls = t.estado === "online" ? "online" : (t.estado === "streaming" ? "streaming" : "offline");
            div.innerHTML = "<div><span class='dot " + cls + "'></span><strong></strong><span class='grupo'></span></div>" +
                "<div class='ip'></div><div class='est'></div>" +
                "<pre class='ficha'></pre>" +
                "<button type='button' class='secundario chico btn-editar'>Editar</button> " +
                "<button type='button' class='secundario chico btn-del'>Eliminar</button>";
            div.querySelector("strong").textContent = t.nombre + " (" + t.deviceId + ")";
            div.querySelector(".grupo").textContent = grupoDe(t);
            div.querySelector(".ip").textContent = (t.ip || "sin IP") + (t.conectadaWs ? " · WS" : "");
            div.querySelector(".est").textContent = t.estado + " · " + (t.ultimaConexion || "nunca conectada");
            div.querySelector(".ficha").textContent =
                "En la APK → Configurar (una sola vez):\n" +
                "Servidor: " + (servidor.ip || "") + "\n" +
                "Puerto: " + (servidor.puerto || "") + "\n" +
                "Código: " + t.deviceId + "\n" +
                "Token: " + (t.token || "");
            div.querySelector("strong").parentNode.onclick = function () {
                sel.has(t.deviceId) ? sel.delete(t.deviceId) : sel.add(t.deviceId);
                pintarLab();
            };
            div.querySelector(".btn-editar").onclick = function (ev) { editarTv(ev, t); };
            div.querySelector(".btn-del").onclick = function (ev) { eliminarTv(ev, t); };
            box.appendChild(div);
        });
        if (!tvsLab().length) box.innerHTML = "<p>Este laboratorio no tiene TVs. Agrégalas desde Laboratorios.</p>";
        var s = sesionDelLab();
        document.getElementById("sesionLab").innerHTML = s
            ? "<div class='sesion-activa'>Transmitiendo sesión <strong>" + s.sessionId + "</strong> → " + s.participantes.join(", ") + "</div>"
            : "";
        var ul = document.getElementById("sesiones");
        ul.innerHTML = "";
        ultimasSesiones.forEach(function (x) {
            var li = document.createElement("li");
            li.textContent = x.sessionId + " · " + x.streamId + " → " + (x.participantes || []).join(", ");
            ul.appendChild(li);
        });
    }

    async function editarTv(ev, t) {
        ev.stopPropagation();
        var nombre = prompt("Nombre:", t.nombre);
        if (nombre === null) return;
        var grupo = prompt("Lab (lab1, lab2…):", grupoDe(t));
        if (grupo === null) return;
        await fetch("api/pantallas/" + encodeURIComponent(t.deviceId), {
            method: "PUT", headers: hdr(),
            body: JSON.stringify({ nombre: nombre, grupo: grupo })
        });
        cargar();
    }

    async function eliminarTv(ev, t) {
        ev.stopPropagation();
        if (!confirm("¿Eliminar " + t.deviceId + "?")) return;
        await fetch("api/pantallas/" + encodeURIComponent(t.deviceId), { method: "DELETE", headers: hdr() });
        sel.delete(t.deviceId);
        cargar();
    }

    document.getElementById("btnVolver").onclick = function () { vista = "home"; pintar(); };
    document.getElementById("btnTodas").onclick = function () {
        var todas = tvsLab().map(function (t) { return t.deviceId; });
        var marcadas = todas.filter(function (id) { return sel.has(id); });
        if (marcadas.length === todas.length) todas.forEach(function (id) { sel.delete(id); });
        else todas.forEach(function (id) { sel.add(id); });
        pintarLab();
    };
    document.getElementById("btnActualizar").onclick = cargar;

    document.getElementById("btnAgregar").onclick = async function () {
        var id = document.getElementById("nuevoId").value.trim().toUpperCase();
        var nombre = document.getElementById("nuevoNombre").value.trim();
        var grupo = document.getElementById("nuevoGrupo").value.trim() || "lab1";
        if (!id) { alert("Escribe el código (ej. LAB1-01)."); return; }
        var r = await fetch("api/pantallas", {
            method: "POST", headers: hdr(),
            body: JSON.stringify({ deviceId: id, nombre: nombre, grupo: grupo })
        });
        if (!r.ok) {
            var e;
            try { e = await r.json(); } catch (x) { e = {}; }
            alert("No se pudo agregar: " + (e.detail || r.status));
            return;
        }
        document.getElementById("nuevoId").value = "";
        document.getElementById("nuevoNombre").value = "";
        cargar();
    };

    document.getElementById("btnSesion").onclick = async function () {
        var ids = tvsLab().filter(function (t) { return sel.has(t.deviceId); }).map(function (t) { return t.deviceId; });
        if (!ids.length) { alert("Selecciona al menos una TV de este laboratorio."); return; }
        var r = await fetch("api/sesiones", {
            method: "POST", headers: hdr(),
            body: JSON.stringify({ streamId: "laptop-01", deviceIds: ids })
        });
        if (!r.ok) { alert("No se pudo crear la sesión: " + r.status); return; }
        var d = await r.json();
        var msg = "Sesión " + d.sessionId + " lista para " + d.participantes.join(", ") + ". Abre la emisora de este lab y pulsa Transmitir.";
        if (d.omitidas && d.omitidas.length) msg += "\nOmitidas por ocupadas: " + d.omitidas.join(", ");
        alert(msg);
        cargar();
    };

    document.getElementById("btnDetener").onclick = async function () {
        var s = sesionDelLab();
        if (!s) { alert("Este laboratorio no tiene sesión activa."); return; }
        await fetch("api/sesiones/" + encodeURIComponent(s.sessionId), { method: "DELETE", headers: hdr() });
        cargar();
    };

    if (labActual && labActual !== "home") vista = "lab";
    cargar();
    setInterval(cargar, 10000);
})();
