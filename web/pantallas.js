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
    // "1 TV", "3 TVs": textos correctos en singular y plural.
    function pl(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }

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

    function marcarServidor(ok, texto, detalle) {
        var s = document.getElementById("servidorInfo");
        s.classList.toggle("ok", ok);
        s.classList.toggle("mal", !ok);
        s.title = detalle || "";
        document.getElementById("servidorTxt").textContent = texto;
    }

    async function cargar() {
        var r;
        try {
            r = await fetch("api/pantallas", { headers: { "X-Api-Key": clave() } });
        } catch (e) {
            marcarServidor(false, "Sin conexión");
            return;
        }
        if (!r.ok) {
            marcarServidor(false, "Error " + r.status);
            document.getElementById("labCards").innerHTML =
                "<div class='vacio'>No se pudo leer la lista de pantallas (error " + r.status + "). Avisa a soporte técnico: puede que la clave de acceso (ícono de llave, arriba a la derecha) no sea correcta.</div>";
            return;
        }
        var d = await r.json();
        servidor = d.servidor || {};
        ultimasTvs = d.pantallas || [];
        ultimasSesiones = d.sesiones || [];
        // Solo presentación: detecta TVs que cambiaron de estado desde la última consulta.
        var cambios = [];
        ultimasTvs.forEach(function (t) {
            var antes = estadosPrevios[t.deviceId];
            if (antes && antes !== t.estado) cambios.push({ t: t, antes: antes });
            estadosPrevios[t.deviceId] = t.estado;
        });
        marcarServidor(true, "Sistema conectado", "Servidor " + (servidor.ip || "") + ":" + (servidor.puerto || ""));
        pintar();
        efectosCambios(cambios);
    }

    var estadosPrevios = {};
    var NOMBRE_ESTADO = { online: "lista para usar", streaming: "transmitiendo", offline: "apagada o sin conexión" };
    var ESTADO_CORTO = { online: "Lista", streaming: "En vivo", offline: "Apagada" };
    function efectosCambios(cambios) {
        if (!cambios.length) return;
        if (cambios.length <= 3) {
            cambios.forEach(function (c) {
                UI.toast(c.t.deviceId + " · " + c.t.nombre + " ahora está " + (NOMBRE_ESTADO[c.t.estado] || c.t.estado) + ".",
                    c.t.estado === "offline" ? "aviso" : "ok", 3800);
            });
        } else {
            UI.toast(cambios.length + " TVs cambiaron de estado.", "ok");
        }
        if (vista !== "lab") return;
        cambios.forEach(function (c) {
            var card = document.querySelector("#lista [data-id=\"" + CSS.escape(c.t.deviceId) + "\"]");
            UI.cambioEstado(card, c.antes, c.t.estado);
        });
    }

    function pintar() {
        var cambio = vistaPintada !== vista + ":" + labActual;
        vistaPintada = vista + ":" + labActual;
        var home = document.getElementById("vistaHome"), lab = document.getElementById("vistaLab");
        home.classList.toggle("oculto", vista !== "home");
        lab.classList.toggle("oculto", vista !== "lab");
        if (cambio) UI.arriba();
        if (vista === "home") pintarHome(cambio);
        else pintarLab(cambio);
        if (cambio) UI.refrescar();
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
        // Cintillo de noticias con los datos reales del edificio
        var hora = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false });
        var partes = ["Universidad Mesoamericana", hora + " · " + pl(c.total, "pantalla registrada", "pantallas registradas"),
            pl(c.st, "transmitiendo", "transmitiendo") + " ahora", "Sistema de Pantallas"];
        gs.forEach(function (g) {
            var k = cuenta(ultimasTvs.filter(function (t) { return grupoDe(t) === g; }));
            partes.push(g + " — " + pl(k.total, "TV", "TVs") + " · " + k.st + " en vivo · " + pl(k.on, "lista", "listas") + " · " + pl(k.off, "apagada", "apagadas"));
        });
        UI.cintillo([document.getElementById("cintilloA"), document.getElementById("cintilloB")], partes);

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
                    "<span class='idx'>" + (par[0] === "todas" ? "TODA LA UNIVERSIDAD" : "CANAL " + String(i).padStart(2, "0")) + "</span>" +
                    "<div><h3></h3><div class='puntos'>" + tvs.map(function (t) {
                        return "<i class='" + esc(t.estado) + "' title='" + esc(t.deviceId + " · " + (ESTADO_CORTO[t.estado] || t.estado)) + "'></i>";
                    }).join("") + "</div></div>" +
                    "<div class='lab-pie'><div class='lab-stats'>" +
                    "<span><b>" + k.total + "</b>" + (k.total === 1 ? "TV" : "TVs") + "</span>" +
                    "<span><b class='on'>" + k.on + "</b>" + (k.on === 1 ? "lista" : "listas") + "</span>" +
                    "<span><b class='st'>" + k.st + "</b>en vivo</span>" +
                    "<span><b class='off'>" + k.off + "</b>" + (k.off === 1 ? "apagada" : "apagadas") + "</span>" +
                    "</div><span class='lab-ir' aria-hidden='true'>Entrar <span class='flecha'>→</span></span></div>";
                card.querySelector("h3").textContent = par[1];
                card.setAttribute("aria-label", "Entrar a " + par[1] + ": " + k.total + " TVs, " + k.on + " listas, " + k.st + " en vivo");
                card.dataset.osd = par[0] === "todas" ? "Todas las TVs" : "Canal " + String(i).padStart(2, "0") + " · " + par[0];
                card.onclick = function () {
                    irA("lab", par[0], card);
                };
                box.appendChild(card);
            });
        }
        if (animar) {
            var primera = !homeAnimado;
            if (primera) {
                homeAnimado = true;
                UI.titular(document.getElementById("titular"), .25, true);
                UI.descifrar(document.querySelector(".hero-texto .etiqueta"), UI.retraso(.3), 1.1);
                UI.entrada(".hero-sub", { delay: .6, y: 24 });
                UI.entrada("#kpis .kpi", { delay: .8, paso: .09, y: 60, rotate: 2 });
            }
            UI.entrada(box.children, { scroll: true, delay: .05, y: 90, rotate: 2.5, scale: .96 });
            UI.entrada(box.querySelectorAll(".puntos i"), {
                scroll: true, delay: .55, y: 0, scale: 0, paso: .018, duracion: .7, ease: "back.out(3)"
            });
        }
    }

    function irA(nuevaVista, lab, origen) {
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
        if (nuevaVista === "lab" && origen) {
            UI.expandir(origen, lab === "todas" ? "Todas las TVs" : lab, origen.dataset.osd, origen.classList.contains("todas"), salir);
        } else {
            UI.cambioCanal("Inicio · Laboratorios", "Laboratorios", salir);
        }
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

    var ETQ = { online: "Lista", streaming: "En vivo", offline: "Apagada" };
    var ESTADO_LARGO = { online: "Lista para usar", streaming: "Transmitiendo", offline: "Apagada o sin conexión" };
    var CHECK = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 12.5l4.5 4.5L19 7.5'/></svg>";

    function fichaTexto(t) {
        return "En la APK → Configurar (una sola vez):\n" +
            "Servidor: " + (servidor.ip || "") + "\n" +
            "Puerto: " + (servidor.puerto || "") + "\n" +
            "Código: " + t.deviceId + "\n" +
            "Token: " + (t.token || "");
    }

    function tarjetaDe(id) {
        return document.querySelector("#lista [data-id=\"" + CSS.escape(id) + "\"]");
    }

    function alternar(t) {
        sel.has(t.deviceId) ? sel.delete(t.deviceId) : sel.add(t.deviceId);
        pintarLab(false);
        UI.marcar(tarjetaDe(t.deviceId), sel.has(t.deviceId));
    }

    var marcadasPrevias = -1, sesionMostrada = null;
    function pintarLab(animar) {
        var tvs = tvsLab();
        var titulo = document.getElementById("labTitulo");
        var nombreLab = labActual === "todas" ? "Todas las TVs" : labActual.charAt(0).toUpperCase() + labActual.slice(1);
        if (animar || titulo.textContent !== nombreLab) titulo.textContent = nombreLab;
        var k = cuenta(tvs);
        var resumen = document.getElementById("labResumen");
        if (!resumen.firstChild) {
            resumen.innerHTML = "<span><b class='num' id='rTot'></b>TVs</span><span><b class='num' id='rOn'></b>listas</span><span><b class='num' id='rSt'></b>en vivo</span>";
        }
        UI.odometro(document.getElementById("rTot"), k.total);
        UI.odometro(document.getElementById("rOn"), k.on);
        UI.odometro(document.getElementById("rSt"), k.st);
        var marcadas = tvs.filter(function (t) { return sel.has(t.deviceId); }).length;
        document.getElementById("contadorSel").innerHTML = "<b>" + marcadas + "</b> de " + tvs.length + " marcadas";
        if (marcadasPrevias >= 0 && marcadas !== marcadasPrevias && UI.anima()) {
            UI.gsap.fromTo("#contadorSel b", { yPercent: marcadas > marcadasPrevias ? 80 : -80, opacity: 0, scale: 1.6 },
                { yPercent: 0, opacity: 1, scale: 1, duration: .5, ease: "back.out(3)" });
        }
        marcadasPrevias = marcadas;
        document.getElementById("btnTodas").textContent = marcadas && marcadas === tvs.length ? "Quitar selección" : "Seleccionar todas";
        // Guía de pasos: el paso 3 se activa en cuanto hay al menos una TV marcada.
        var g2 = document.getElementById("guia2"), g3 = document.getElementById("guia3");
        var antesListo = g3.classList.contains("actual");
        g2.className = marcadas ? "hecho" : "actual";
        g3.className = marcadas ? "actual" : "";
        if (!antesListo && marcadas && UI.anima()) {
            UI.gsap.fromTo(g3, { scale: .94 }, { scale: 1, duration: .7, ease: "elastic.out(1, .5)", clearProps: "scale" });
            UI.gsap.fromTo("#btnSesion", { scale: .9 }, { scale: 1, duration: .8, ease: "elastic.out(1, .4)", clearProps: "scale" });
        }

        var box = document.getElementById("lista");
        box.innerHTML = "";
        tvs.forEach(function (t) {
            var div = document.createElement("article");
            var cls = t.estado === "online" ? "online" : (t.estado === "streaming" ? "streaming" : "offline");
            div.className = "tv spot" + (sel.has(t.deviceId) ? " sel" : "");
            div.dataset.estado = cls;
            div.dataset.id = t.deviceId;
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
                "<button type='button' class='fantasma btn-ficha' title='Servidor, puerto, código y token para configurar la TV'>Datos técnicos</button>" +
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
            div.querySelector(".est").textContent = ESTADO_LARGO[cls];
            div.setAttribute("aria-label", t.nombre + ", " + ESTADO_LARGO[cls] + (sel.has(t.deviceId) ? ", marcada" : ""));
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
            ? "<div class='sesion-activa'><span class='en-vivo'><i></i>EN VIVO</span><span>Transmisión <code>" + esc(s.sessionId) +
              "</code></span><span class='chips-p'>" + s.participantes.map(function (p) { return "<span>" + esc(p) + "</span>"; }).join("") + "</span></div>"
            : "";
        var sid = s ? s.sessionId : null;
        if (sid !== sesionMostrada) {
            if (s && !animar && UI.anima()) {
                UI.gsap.from(".sesion-activa", { clipPath: "inset(0% 100% 0% 0% round 18px)", duration: 1, ease: "expo.inOut" });
                UI.gsap.from(".sesion-activa > *", { x: -24, opacity: 0, duration: .8, ease: "expo.out", stagger: .07, delay: .35 });
            }
            sesionMostrada = sid;
        }
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
            var g = UI.gsap, d = UI.retraso(.1);
            g.from(".volver", { x: -30, opacity: 0, duration: .9, ease: "expo.out", delay: d, clearProps: "all" });
            UI.titular(titulo, .15);
            g.from("#labResumen > span", { y: 20, opacity: 0, duration: .8, ease: "expo.out", stagger: .07, delay: d + .25, clearProps: "all" });
            g.from(".barra", { y: 30, opacity: 0, duration: .9, ease: "expo.out", delay: d + .15, clearProps: "all" });
            if (s) g.from(".sesion-activa", { clipPath: "inset(0% 100% 0% 0% round 18px)", duration: 1, ease: "expo.inOut", delay: d + .2 });
            UI.entrada(box.children, { delay: .3, y: 90, scale: .94, rotate: 1.5 });
            // Al entrar al canal, cada pantallita se enciende en cascada.
            box.querySelectorAll(".tv-pantalla").forEach(function (p, i) { UI.encenderPantalla(p, d + .55 + i * .08); });
            UI.entrada(ul.children, { scroll: true, x: -30, y: 0, paso: .06 });
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
        var quitar = marcadas.length === todas.length;
        if (quitar) todas.forEach(function (id) { sel.delete(id); });
        else todas.forEach(function (id) { sel.add(id); });
        pintarLab();
        todas.forEach(function (id, i) { UI.marcar(tarjetaDe(id), !quitar, i * .04); });
    };
    document.getElementById("btnActualizar").onclick = function () {
        if (UI.anima()) UI.gsap.fromTo("#btnActualizar svg", { rotate: 0 }, { rotate: 360, duration: .8, ease: "expo.out" });
        cargar();
    };

    //--- Ticket en vivo del formulario de alta ---------------------------------
    var barras = document.getElementById("tkBarras");
    function pintarTicket(ev) {
        var id = document.getElementById("nuevoId").value.trim().toUpperCase();
        var idPrevio = document.getElementById("tkId").textContent;
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
        // Solo presentación: el código de barras se "imprime" al cambiar el código.
        if (ev && UI.anima() && idPrevio !== (id || "LAB1-01")) {
            UI.gsap.from(barras.children, { scaleY: 0, transformOrigin: "50% 100%", duration: .5, ease: "expo.out", stagger: .006 });
            UI.gsap.fromTo("#tkId", { y: 8, opacity: .4 }, { y: 0, opacity: 1, duration: .35, ease: "expo.out" });
        }
    }
    ["nuevoId", "nuevoNombre", "nuevoGrupo"].forEach(function (id) {
        document.getElementById(id).addEventListener("input", pintarTicket);
        document.getElementById(id).addEventListener("keydown", function (e) {
            if (e.key === "Enter") document.getElementById("btnAgregar").click();
        });
    });
    pintarTicket();

    // Guía "¿Cómo se usa?": las tarjetas entran en cascada, los números rebotan
    // y la línea punteada que los une se dibuja con el scroll.
    UI.entrada("#pasosGuia .paso", { scroll: true, y: 70, rotate: 2, paso: .12 });
    UI.entrada("#pasosGuia .paso-num", { scroll: true, y: 0, scale: 0, paso: .12, delay: .35, duracion: .9, ease: "back.out(2.6)" });
    if (UI.anima() && window.ScrollTrigger) {
        UI.gsap.fromTo("#pasosGuia .trazo", { scaleX: 0 }, {
            scaleX: 1, ease: "none",
            scrollTrigger: { trigger: "#pasosGuia", start: "top 85%", end: "top 35%", scrub: .6 }
        });
    }
    UI.entrada("#admin", { scroll: true, y: 40 });

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
            // El ticket sale volando (impreso) y entra uno nuevo desde abajo.
            UI.protegido(".ticket", UI.gsap.timeline()
                .to(".ticket", { y: -160, x: 60, rotate: -14, opacity: 0, duration: .6, ease: "power3.in" })
                .set(".ticket", { y: 160, x: 0, rotate: 10 })
                .to(".ticket", { y: 0, rotate: 1.6, opacity: 1, duration: 1.1, ease: "expo.out", clearProps: "transform,opacity" }));
        }
        UI.toast(id + " agregada. Abre su laboratorio para ver la ficha con el token.", "ok");
        document.getElementById("nuevoId").value = "";
        document.getElementById("nuevoNombre").value = "";
        setTimeout(pintarTicket, 450);
        cargar();
    };

    document.getElementById("btnSesion").onclick = async function () {
        var ids = tvsLab().filter(function (t) { return sel.has(t.deviceId); }).map(function (t) { return t.deviceId; });
        if (!ids.length) {
            UI.toast("Primero toca una o más pantallas para marcarlas.", "aviso");
            if (UI.anima()) UI.gsap.fromTo("#guia2", { x: -10 }, { x: 0, duration: .7, ease: "elastic.out(1.2, .3)" });
            return;
        }
        var r = await fetch("api/sesiones", {
            method: "POST", headers: hdr(),
            body: JSON.stringify({ streamId: "laptop-01", deviceIds: ids })
        });
        if (!r.ok) { UI.toast("No se pudo preparar la transmisión (error " + r.status + ").", "error"); return; }
        var d = await r.json();
        var msg = "Las pantallas " + d.participantes.join(", ") + " ya están esperando tu señal.\n\n" +
            "Ahora ve a Transmitir, pulsa «Compartir mi pantalla» y luego «Transmitir a las TVs».";
        if (d.omitidas && d.omitidas.length) msg += "\n\nNo se incluyeron por estar ocupadas en otra transmisión: " + d.omitidas.join(", ");
        UI.aviso("¡Listo! Transmisión preparada", msg, { texto: "Ir a Transmitir", href: "emisora.html" });
        cargar();
    };

    document.getElementById("btnDetener").onclick = async function () {
        var s = sesionDelLab();
        if (!s) { UI.toast("Este laboratorio no está transmitiendo ahora.", "aviso"); return; }
        await fetch("api/sesiones/" + encodeURIComponent(s.sessionId), { method: "DELETE", headers: hdr() });
        UI.toast("Transmisión detenida. Las pantallas quedaron libres.", "ok");
        cargar();
    };

    //--- Administración plegable (solo presentación) ----------------------------
    document.getElementById("btnAdmin").onclick = function () {
        var caja = document.getElementById("admin");
        var abierta = caja.classList.toggle("abierta");
        this.setAttribute("aria-expanded", abierta);
        if (abierta && UI.anima()) {
            UI.entrada(caja.querySelectorAll(".alta-form .fila > label, #btnAgregar, .alta-form .nota"), { y: 30, paso: .07, delay: .15 });
            UI.protegido(".ticket", UI.gsap.fromTo(".ticket", { y: 80, rotate: 10, opacity: 0 }, { y: 0, rotate: 1.6, opacity: 1, duration: 1.1, ease: "expo.out", delay: .25, clearProps: "transform,opacity" }));
        }
        setTimeout(UI.refrescar, 650);
    };

    UI.magnetico(document.getElementById("btnSesion"), .25);
    UI.magnetico(document.getElementById("btnAgregar"), .25);

    if (labActual && labActual !== "home") vista = "lab";
    cargar();
    setInterval(cargar, 10000);
})();
