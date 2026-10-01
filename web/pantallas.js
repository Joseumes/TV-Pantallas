// Panel operador: home de laboratorios + vista por lab + sesiones.
// Varios labs pueden transmitir a la vez (sesiones independientes por lab).
// La API Key viene embebida del servidor (config-web.js); el campo manual la sobreescribe.
(function () {
    "use strict";
    var CLAVE = "pantallas.apiKey";
    var sel = new Set();
    var fichasAbiertas = new Set();
    var servidor = {};
    var ultimasTvs = [], ultimasSesiones = [];
    var vista = "home", labActual = localStorage.getItem("pantallas.lab") || null;
    var vistaPintada = null;
    var onda = UI.onda(document.getElementById("onda"));
    var esc = UI.esc;

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
        document.querySelector(".llave").classList.remove("abierta");
        UI.toast("API Key guardada en este navegador.", "ok");
        cargar();
    };

    document.getElementById("fechaHoy").textContent = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

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

    function cuenta(tvs) {
        var on = tvs.filter(function (t) { return t.estado === "online"; }).length;
        var st = tvs.filter(function (t) { return t.estado === "streaming"; }).length;
        return { total: tvs.length, on: on, st: st, off: tvs.length - on - st };
    }

    function marcarServidor(ok, texto) {
        var s = document.getElementById("servidorInfo");
        s.classList.toggle("ok", ok);
        s.classList.toggle("mal", !ok);
        document.getElementById("servidorTxt").textContent = texto;
    }

    async function cargar() {
        var r;
        try {
            r = await fetch("api/pantallas", { headers: { "X-Api-Key": clave() } });
        } catch (e) {
            marcarServidor(false, "sin conexión");
            return;
        }
        if (!r.ok) {
            marcarServidor(false, "error " + r.status);
            document.getElementById("labCards").innerHTML =
                "<div class='vacio'>Error " + r.status + " — revisa la API Key (icono de llave, arriba a la derecha).</div>";
            return;
        }
        var d = await r.json();
        servidor = d.servidor || {};
        ultimasTvs = d.pantallas || [];
        ultimasSesiones = d.sesiones || [];
        marcarServidor(true, (servidor.ip || "") + ":" + (servidor.puerto || ""));
        pintar();
    }

    function pintar() {
        var cambio = vistaPintada !== vista + ":" + labActual;
        vistaPintada = vista + ":" + labActual;
        var home = document.getElementById("vistaHome"), lab = document.getElementById("vistaLab");
        home.classList.toggle("oculto", vista !== "home");
        lab.classList.toggle("oculto", vista !== "lab");
        if (vista === "home") pintarHome(cambio);
        else pintarLab(cambio);
        if (cambio) window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    }

    //--- Home ----------------------------------------------------------------
    var homeAnimado = false;
    function pintarHome(animar) {
        var c = cuenta(ultimasTvs);
        UI.contar(document.getElementById("kTotal"), c.total);
        UI.contar(document.getElementById("kOn"), c.on);
        UI.contar(document.getElementById("kSt"), c.st);
        UI.contar(document.getElementById("kOff"), c.off);
        onda.set(ultimasTvs);
        document.getElementById("tkSrv").textContent = servidor.ip || "—";
        document.getElementById("tkPto").textContent = servidor.puerto || "—";

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
        if (!gs.length) {
            box.innerHTML = "<div class='vacio'>Aún no hay TVs. Agrega la primera abajo y aparecerá su laboratorio aquí.</div>";
        } else {
            [["todas", "Todas las TVs"]].concat(gs.map(function (g) { return [g, g]; })).forEach(function (par, i) {
                var tvs = par[0] === "todas" ? ultimasTvs : ultimasTvs.filter(function (t) { return grupoDe(t) === par[0]; });
                var k = cuenta(tvs);
                var card = document.createElement("button");
                card.type = "button";
                card.className = "lab-card tarjeta spot" + (par[0] === "todas" ? " todas" : "");
                card.innerHTML =
                    "<span class='idx'>" + (par[0] === "todas" ? "TODO" : "CH " + String(i).padStart(2, "0")) + "</span>" +
                    "<div><h3></h3><div class='puntos'>" + tvs.map(function (t) {
                        return "<i class='" + esc(t.estado) + "' title='" + esc(t.deviceId + " · " + t.estado) + "'></i>";
                    }).join("") + "</div></div>" +
                    "<div class='lab-pie'><div class='lab-stats'>" +
                    "<span><b>" + k.total + "</b>TVs</span>" +
                    "<span><b class='on'>" + k.on + "</b>en línea</span>" +
                    "<span><b class='st'>" + k.st + "</b>al aire</span>" +
                    "<span><b class='off'>" + k.off + "</b>fuera</span>" +
                    "</div><span class='lab-ir' aria-hidden='true'>→</span></div>";
                card.querySelector("h3").textContent = par[1];
                card.onclick = function () {
                    irA("lab", par[0]);
                };
                box.appendChild(card);
            });
        }
        if (animar) {
            var primera = !homeAnimado;
            if (primera) {
                homeAnimado = true;
                UI.titular(document.getElementById("titular"), .25);
                UI.entrada(".hero-texto .etiqueta, .hero-sub", { delay: .5, y: 24 });
                UI.entrada("#kpis .kpi", { delay: .8, paso: .09 });
            }
            UI.entrada(box.children, { delay: primera ? .95 : .15, rotate: 1.5 });
        }
    }

    function irA(nuevaVista, lab) {
        var salir = function () {
            vista = nuevaVista;
            if (lab !== undefined) {
                labActual = lab;
                localStorage.setItem("pantallas.lab", labActual);
                sel.clear();
                fichasAbiertas.clear();
            }
            pintar();
        };
        var actual = document.getElementById(vista === "home" ? "vistaHome" : "vistaLab");
        if (UI.anima()) {
            UI.gsap.to(actual, { opacity: 0, y: -18, duration: .3, ease: "power2.in", onComplete: function () {
                UI.gsap.set(actual, { clearProps: "all" });
                salir();
            } });
        } else salir();
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

    var ETQ = { online: "En espera", streaming: "En vivo", offline: "Sin señal" };
    var CHECK = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 12.5l4.5 4.5L19 7.5'/></svg>";

    function fichaTexto(t) {
        return "En la APK → Configurar (una sola vez):\n" +
            "Servidor: " + (servidor.ip || "") + "\n" +
            "Puerto: " + (servidor.puerto || "") + "\n" +
            "Código: " + t.deviceId + "\n" +
            "Token: " + (t.token || "");
    }

    function alternar(t) {
        sel.has(t.deviceId) ? sel.delete(t.deviceId) : sel.add(t.deviceId);
        pintarLab(false);
    }

    function pintarLab(animar) {
        var tvs = tvsLab();
        document.getElementById("labTitulo").textContent = labActual === "todas" ? "Todas las TVs" : labActual;
        var k = cuenta(tvs);
        document.getElementById("labResumen").innerHTML =
            "<span><b>" + k.total + "</b>TVs</span><span><b>" + k.on + "</b>en espera</span><span><b>" + k.st + "</b>al aire</span>";
        var marcadas = tvs.filter(function (t) { return sel.has(t.deviceId); }).length;
        document.getElementById("contadorSel").innerHTML = "<b>" + marcadas + "</b> de " + tvs.length + " marcadas";
        document.getElementById("btnTodas").textContent = marcadas && marcadas === tvs.length ? "Quitar selección" : "Seleccionar todas";

        var box = document.getElementById("lista");
        box.innerHTML = "";
        tvs.forEach(function (t) {
            var div = document.createElement("article");
            var cls = t.estado === "online" ? "online" : (t.estado === "streaming" ? "streaming" : "offline");
            div.className = "tv spot" + (sel.has(t.deviceId) ? " sel" : "");
            div.dataset.estado = cls;
            div.tabIndex = 0;
            div.setAttribute("role", "button");
            div.setAttribute("aria-pressed", sel.has(t.deviceId));
            div.innerHTML =
                "<div class='tv-pantalla'><div class='barras'></div><div class='scan'></div><div class='velo'></div>" +
                "<span class='tv-check'>" + CHECK + "</span>" +
                "<span class='tv-tag'>" + (cls === "streaming" ? "● " : "") + ETQ[cls] + "</span>" +
                "<span class='tv-id'></span></div>" +
                "<div class='tv-cuerpo'><div class='nombre'><span class='dot " + cls + "'></span><strong></strong></div>" +
                "<div class='tv-meta'><span class='est'></span><span class='ip'></span><span class='vista'></span></div></div>" +
                "<div class='tv-acciones'>" +
                "<button type='button' class='fantasma btn-ficha'>Ficha</button>" +
                "<span class='espacio'></span>" +
                "<button type='button' class='fantasma btn-editar'>Editar</button>" +
                "<button type='button' class='fantasma btn-del'>Eliminar</button></div>" +
                "<div class='tv-ficha" + (fichasAbiertas.has(t.deviceId) ? " abierta" : "") + "'><div><div class='ficha'>" +
                "<div class='fila-f'><span>Servidor</span><span class='f-srv'></span></div>" +
                "<div class='fila-f'><span>Puerto</span><span class='f-pto'></span></div>" +
                "<div class='fila-f'><span>Código</span><span class='f-id'></span></div>" +
                "<div class='fila-f'><span>Token</span><span class='f-tok tok' title='Clic para mostrar'></span></div>" +
                "<div class='acc'><button type='button' class='secundario chico btn-copiar'>Copiar ficha</button></div>" +
                "</div></div></div>";
            div.querySelector(".tv-id").textContent = t.deviceId;
            div.querySelector("strong").textContent = t.nombre;
            div.querySelector(".est").textContent = t.estado;
            div.querySelector(".ip").textContent = (t.ip || "sin IP") + (t.conectadaWs ? " · WS" : "");
            div.querySelector(".vista").textContent = UI.hace(t.ultimaConexion);
            div.querySelector(".vista").title = t.ultimaConexion || "nunca conectada";
            if (labActual === "todas") div.querySelector(".ip").textContent += " · " + grupoDe(t);
            div.querySelector(".f-srv").textContent = servidor.ip || "";
            div.querySelector(".f-pto").textContent = servidor.puerto || "";
            div.querySelector(".f-id").textContent = t.deviceId;
            var tok = div.querySelector(".f-tok");
            tok.textContent = t.token ? "••••••••" + t.token.slice(-4) : "";
            tok.onclick = function () { tok.textContent = t.token || ""; };

            div.onclick = function () { alternar(t); };
            div.onkeydown = function (ev) {
                if (ev.target !== div) return;
                if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); alternar(t); }
            };
            div.querySelector(".tv-ficha").onclick = function (ev) { ev.stopPropagation(); };
            div.querySelector(".btn-ficha").onclick = function (ev) {
                ev.stopPropagation();
                var f = div.querySelector(".tv-ficha");
                f.classList.toggle("abierta");
                f.classList.contains("abierta") ? fichasAbiertas.add(t.deviceId) : fichasAbiertas.delete(t.deviceId);
            };
            div.querySelector(".btn-copiar").onclick = function (ev) { ev.stopPropagation(); UI.copiar(fichaTexto(t)); };
            div.querySelector(".btn-editar").onclick = function (ev) { editarTv(ev, t); };
            div.querySelector(".btn-del").onclick = function (ev) { eliminarTv(ev, t); };
            box.appendChild(div);
        });
        if (!tvs.length) box.innerHTML = "<div class='vacio'>Este laboratorio no tiene TVs. Agrégalas desde Laboratorios.</div>";

        var s = sesionDelLab();
        document.getElementById("sesionLab").innerHTML = s
            ? "<div class='sesion-activa'><span class='en-vivo'><i></i>AL AIRE</span><span>Sesión <code>" + esc(s.sessionId) +
              "</code></span><span class='chips-p'>" + s.participantes.map(function (p) { return "<span>" + esc(p) + "</span>"; }).join("") + "</span></div>"
            : "";
        var ul = document.getElementById("sesiones");
        ul.innerHTML = "";
        ultimasSesiones.forEach(function (x) {
            var li = document.createElement("li");
            li.innerHTML = "<code></code><span class='stream'></span><span class='a'>→</span><span class='p'></span>";
            li.querySelector("code").textContent = x.sessionId;
            li.querySelector(".stream").textContent = x.streamId;
            li.querySelector(".p").textContent = (x.participantes || []).join(", ");
            ul.appendChild(li);
        });

        if (animar && UI.anima()) {
            var g = UI.gsap;
            g.from(".volver", { x: -20, opacity: 0, duration: .8, ease: "expo.out", clearProps: "all" });
            g.from("#labTitulo", { yPercent: 60, opacity: 0, duration: 1.1, ease: "expo.out", clearProps: "all" });
            g.from("#labResumen > span", { y: 14, opacity: 0, duration: .8, ease: "expo.out", stagger: .06, delay: .2, clearProps: "all" });
            g.from(".barra", { y: 24, opacity: 0, duration: .9, ease: "expo.out", delay: .15, clearProps: "all" });
            UI.entrada(box.children, { delay: .25, y: 60, scale: .96 });
        }
    }

    async function editarTv(ev, t) {
        ev.stopPropagation();
        var r = await UI.formulario({
            titulo: "Editar " + t.deviceId,
            texto: "El nombre y el laboratorio se gestionan desde aquí; la TV no los pisa.",
            campos: [
                { id: "nombre", label: "Nombre", valor: t.nombre },
                { id: "grupo", label: "Laboratorio (lab1, lab2…)", valor: grupoDe(t), lista: "gruposExistentes" }
            ]
        });
        if (!r) return;
        await fetch("api/pantallas/" + encodeURIComponent(t.deviceId), {
            method: "PUT", headers: hdr(),
            body: JSON.stringify({ nombre: r.nombre, grupo: r.grupo })
        });
        UI.toast(t.deviceId + " actualizada.", "ok");
        cargar();
    }

    async function eliminarTv(ev, t) {
        ev.stopPropagation();
        var ok = await UI.confirmar({
            titulo: "¿Eliminar " + t.deviceId + "?",
            texto: "La TV se desconecta y su token deja de servir. Tendrás que volver a agregarla y configurarla.",
            ok: "Eliminar", peligro: true
        });
        if (!ok) return;
        await fetch("api/pantallas/" + encodeURIComponent(t.deviceId), { method: "DELETE", headers: hdr() });
        sel.delete(t.deviceId);
        UI.toast(t.deviceId + " eliminada.", "aviso");
        cargar();
    }

    document.getElementById("btnVolver").onclick = function () { irA("home"); };
    document.getElementById("btnTodas").onclick = function () {
        var todas = tvsLab().map(function (t) { return t.deviceId; });
        var marcadas = todas.filter(function (id) { return sel.has(id); });
        if (marcadas.length === todas.length) todas.forEach(function (id) { sel.delete(id); });
        else todas.forEach(function (id) { sel.add(id); });
        pintarLab();
    };
    document.getElementById("btnActualizar").onclick = function () {
        if (UI.anima()) UI.gsap.fromTo("#btnActualizar svg", { rotate: 0 }, { rotate: 360, duration: .8, ease: "expo.out" });
        cargar();
    };

    //--- Ticket en vivo del formulario de alta ---------------------------------
    var barras = document.getElementById("tkBarras");
    function pintarTicket() {
        var id = document.getElementById("nuevoId").value.trim().toUpperCase();
        var nombre = document.getElementById("nuevoNombre").value.trim();
        var grupo = document.getElementById("nuevoGrupo").value.trim() || "lab1";
        document.getElementById("tkId").textContent = id || "LAB1-01";
        document.getElementById("tkNom").textContent = nombre || id || "Lab 1 TV 1";
        document.getElementById("tkLab").textContent = grupo;
        // "Código de barras" derivado del código: cambia al escribir.
        var semilla = (id || "LAB1-01").split("").map(function (c) { return c.charCodeAt(0); });
        var html = "";
        for (var i = 0; i < 46; i++) {
            var v = semilla[i % semilla.length] * (i + 3);
            html += "<i style='width:" + (1 + v % 4) + "px;margin-right:" + (v % 3) + "px'></i>";
        }
        barras.innerHTML = html;
    }
    ["nuevoId", "nuevoNombre", "nuevoGrupo"].forEach(function (id) {
        document.getElementById(id).addEventListener("input", pintarTicket);
        document.getElementById(id).addEventListener("keydown", function (e) {
            if (e.key === "Enter") document.getElementById("btnAgregar").click();
        });
    });
    pintarTicket();

    document.getElementById("btnAgregar").onclick = async function () {
        var id = document.getElementById("nuevoId").value.trim().toUpperCase();
        var nombre = document.getElementById("nuevoNombre").value.trim();
        var grupo = document.getElementById("nuevoGrupo").value.trim() || "lab1";
        if (!id) {
            UI.toast("Escribe el código (ej. LAB1-01).", "aviso");
            if (UI.anima()) UI.gsap.fromTo("#nuevoId", { x: -8 }, { x: 0, duration: .6, ease: "elastic.out(1.2, .3)" });
            document.getElementById("nuevoId").focus();
            return;
        }
        var r = await fetch("api/pantallas", {
            method: "POST", headers: hdr(),
            body: JSON.stringify({ deviceId: id, nombre: nombre, grupo: grupo })
        });
        if (!r.ok) {
            var e;
            try { e = await r.json(); } catch (x) { e = {}; }
            UI.toast("No se pudo agregar: " + (e.detail || r.status), "error");
            return;
        }
        if (UI.anima()) {
            UI.gsap.timeline()
                .to(".ticket", { y: -30, rotate: -4, opacity: 0, duration: .45, ease: "power3.in" })
                .set(".ticket", { y: 30, rotate: 4 })
                .to(".ticket", { y: 0, rotate: 1.6, opacity: 1, duration: .9, ease: "expo.out", clearProps: "transform" });
        }
        UI.toast(id + " agregada. Abre su laboratorio para ver la ficha con el token.", "ok");
        document.getElementById("nuevoId").value = "";
        document.getElementById("nuevoNombre").value = "";
        setTimeout(pintarTicket, 450);
        cargar();
    };

    document.getElementById("btnSesion").onclick = async function () {
        var ids = tvsLab().filter(function (t) { return sel.has(t.deviceId); }).map(function (t) { return t.deviceId; });
        if (!ids.length) { UI.toast("Selecciona al menos una TV de este laboratorio.", "aviso"); return; }
        var r = await fetch("api/sesiones", {
            method: "POST", headers: hdr(),
            body: JSON.stringify({ streamId: "laptop-01", deviceIds: ids })
        });
        if (!r.ok) { UI.toast("No se pudo crear la sesión: " + r.status, "error"); return; }
        var d = await r.json();
        var msg = "Lista para " + d.participantes.join(", ") + ".\nAbre la emisora de este lab y pulsa Transmitir.";
        if (d.omitidas && d.omitidas.length) msg += "\n\nOmitidas por ocupadas: " + d.omitidas.join(", ");
        UI.aviso("Sesión " + d.sessionId + " creada", msg);
        cargar();
    };

    document.getElementById("btnDetener").onclick = async function () {
        var s = sesionDelLab();
        if (!s) { UI.toast("Este laboratorio no tiene sesión activa.", "aviso"); return; }
        await fetch("api/sesiones/" + encodeURIComponent(s.sessionId), { method: "DELETE", headers: hdr() });
        UI.toast("Sesión " + s.sessionId + " detenida.", "ok");
        cargar();
    };

    UI.magnetico(document.getElementById("btnSesion"), .25);
    UI.magnetico(document.getElementById("btnAgregar"), .25);

    if (labActual && labActual !== "home") vista = "lab";
    cargar();
    setInterval(cargar, 10000);
})();
