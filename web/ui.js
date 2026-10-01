// Capa visual compartida (UMES · Sistema de Pantallas). Solo presentación: no
// toca la API ni la lógica.
//
// Guion de movimiento — "todo se comporta como un televisor":
//  Encendido   cada página entra como una TV que se enciende: cortinas verdes
//              UMES que se abren desde una línea de luz. La primera vez de la
//              sesión se presenta la marca (UMES · Sistema de Pantallas).
//  Apagado     al cambiar de página la imagen colapsa a una línea y se apaga.
//  Canales     entrar a un lab = la tarjeta crece hasta llenar la pantalla;
//              volver = cambio de canal con barrido y OSD, como una TV real.
//  Datos       KPIs en odómetro; cintillos de noticias con datos reales que
//              aceleran y se inclinan con la velocidad del scroll.
//  Tarjetas    tilt 3D + luz bajo el cursor; al cambiar de estado la pantallita
//              se enciende, se apaga o hace glitch.
//  Scroll      Lenis + ScrollTrigger: títulos que se descifran, parallax del hero.
(function () {
    "use strict";
    var g = window.gsap;
    var ST = window.ScrollTrigger;
    var reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var punteroFino = window.matchMedia("(pointer: fine)").matches;
    var EXPO = "expo.out";
    var raiz = document.documentElement;
    if (g && ST) g.registerPlugin(ST);
    if (g && window.SplitText) g.registerPlugin(window.SplitText);

    function anima() { return !!g && !reducido; }
    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }
    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    //--- Reloj de arranque: las entradas esperan a que la "TV" termine de encender
    var t0 = performance.now();
    var primeraVez = false;
    try {
        primeraVez = !sessionStorage.getItem("pantallas.encendida");
        sessionStorage.setItem("pantallas.encendida", "1");
    } catch (e) { /* sin storage: arranque corto */ }
    var BASE = anima() ? (primeraVez ? 1.75 : .38) : 0;
    function retraso(d) { return (d || 0) + Math.max(0, BASE - (performance.now() - t0) / 1000); }

    var CANALES = { "": "Inicio", "pantallas.html": "Inicio", "emisora.html": "Transmitir", "tv-sim.html": "TV de prueba" };
    function canal() { return CANALES[location.pathname.split("/").pop()] || "Inicio"; }
    var MARCA_SVG = "<svg class='marca-svg' viewBox='0 0 48 40' aria-hidden='true'><rect x='2.5' y='2.5' width='43' height='29' rx='6'/>" +
        "<path class='arco' d='M15 25v-6a9 9 0 0 1 18 0v6'/><path d='M18 37.5h12'/></svg>";

    //--- Texto que se descifra (glifos aleatorios → texto real) ------------------
    var GLIFOS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%/+·";
    function descifrar(nodo, delay, dur) {
        if (!anima() || !nodo) return;
        if (nodo._desc) nodo._desc.progress(1);
        var partes = [];
        var w = document.createTreeWalker(nodo, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) if (w.currentNode.nodeValue.trim()) partes.push({ n: w.currentNode, t: w.currentNode.nodeValue });
        if (!partes.length) return;
        var o = { p: 0 };
        function pintar() {
            partes.forEach(function (q) {
                var fijos = Math.floor(o.p * q.t.length), s = q.t.slice(0, fijos);
                for (var i = fijos; i < q.t.length; i++) {
                    s += /\s/.test(q.t[i]) ? q.t[i] : GLIFOS[(Math.random() * GLIFOS.length) | 0];
                }
                q.n.nodeValue = s;
            });
        }
        pintar();
        nodo._desc = g.to(o, {
            p: 1, duration: dur || .9, delay: delay || 0, ease: "power1.inOut", onUpdate: pintar,
            onComplete: function () { partes.forEach(function (q) { q.n.nodeValue = q.t; }); nodo._desc = null; }
        });
    }

    // Apaga las transiciones CSS de los elementos mientras GSAP los anima.
    function bloquear(nodos) { g.utils.toArray(nodos).forEach(function (n) { n.classList.add("gs-activo"); }); }
    function liberar(nodos) { g.utils.toArray(nodos).forEach(function (n) { n.classList.remove("gs-activo"); }); }
    function protegido(nodos, anim) {
        bloquear(nodos);
        var prev = anim.eventCallback("onComplete");
        anim.eventCallback("onComplete", function () { liberar(nodos); if (prev) prev(); });
        return anim;
    }

    //--- Encendido CRT al cargar ---------------------------------------------------
    // Solo <main>: la cabecera tiene su propia transición (modo compacto).
    function pagina() { return [document.querySelector("main")].filter(Boolean); }

    // Rendimiento: aquí solo se animan transform y opacity (antes había filtros
    // sobre toda la página, que en equipos modestos daban tirones).
    function encender() {
        if (!anima()) { raiz.classList.remove("pre"); return; }
        var crt = el("div", "crt" + (primeraVez ? " arranque" : ""),
            "<div class='crt-mitad arriba'></div><div class='crt-mitad abajo'></div><div class='crt-linea'></div>" +
            (primeraVez ? "<div class='crt-marca'>" + MARCA_SVG + "<div class='crt-nombre'>UMES</div><div class='crt-sub'>Sistema de Pantallas</div></div>" : "") +
            "<div class='crt-osd'><span>Universidad Mesoamericana</span><span class='crt-b'></span></div>");
        crt.setAttribute("aria-hidden", "true");
        document.body.appendChild(crt);
        raiz.classList.remove("pre");
        var linea = crt.querySelector(".crt-linea"), osd = crt.querySelector(".crt-osd"), marca = crt.querySelector(".crt-marca");
        crt.querySelector(".crt-b").textContent = canal();
        var pag = pagina();
        var tl = g.timeline({
            onComplete: function () {
                crt.remove();
                g.set(pag, { clearProps: "transform,opacity" });
                osdMostrar(canal());
            }
        });
        if (marca) {
            // Presentación de la marca: el ícono se dibuja, "UMES" sube letra a letra.
            var trazos = marca.querySelectorAll("rect, path");
            trazos.forEach(function (p) { var l = p.getTotalLength ? p.getTotalLength() : 200; g.set(p, { strokeDasharray: l, strokeDashoffset: l }); });
            var nombre = marca.querySelector(".crt-nombre");
            nombre.innerHTML = "UMES".split("").map(function (c) { return "<span class='char'>" + c + "</span>"; }).join("");
            g.set(linea, { scaleX: 0, opacity: 0 });
            tl.to(trazos, { strokeDashoffset: 0, duration: .7, ease: "power2.inOut", stagger: .12 })
                .from(nombre.children, { yPercent: 110, duration: .7, ease: EXPO, stagger: .06 }, .25)
                .from(marca.querySelector(".crt-sub"), { opacity: 0, y: 10, duration: .5, ease: EXPO }, .5)
                .add(function () { descifrar(marca.querySelector(".crt-sub"), 0, .6); descifrar(osd, 0, .7); }, .5)
                .from(osd, { opacity: 0, duration: .3 }, .4)
                .to(marca, { y: -24, opacity: 0, duration: .4, ease: "power2.in" }, "+=.35")
                .to(osd, { opacity: 0, duration: .25 }, "<")
                .fromTo(linea, { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: .45, ease: "expo.inOut" }, "-=.1");
        } else {
            g.set(osd, { opacity: 0 });
            tl.fromTo(linea, { scaleX: .25, opacity: 1 }, { scaleX: 1, duration: .2, ease: "power3.out" });
        }
        tl.to(crt.querySelector(".arriba"), { yPercent: -101, duration: .62, ease: "expo.inOut" }, marca ? "-=.05" : ">")
            .to(crt.querySelector(".abajo"), { yPercent: 101, duration: .62, ease: "expo.inOut" }, "<")
            .to(linea, { scaleY: 30, opacity: 0, duration: .45, ease: "power2.out" }, "<")
            .from(pag, { y: 30, opacity: 0, duration: .8, ease: EXPO }, "<.08");
        function saltar() { tl.progress(1); }
        crt.addEventListener("pointerdown", saltar);
    }

    function apagar(alFinal) {
        var crt = el("div", "crt", "<div class='crt-mitad arriba'></div><div class='crt-mitad abajo'></div><div class='crt-linea'></div>");
        crt.setAttribute("aria-hidden", "true");
        document.body.appendChild(crt);
        var linea = crt.querySelector(".crt-linea");
        g.timeline({ onComplete: alFinal })
            .fromTo(crt.querySelector(".arriba"), { yPercent: -101 }, { yPercent: 0, duration: .4, ease: "expo.in" })
            .fromTo(crt.querySelector(".abajo"), { yPercent: 101 }, { yPercent: 0, duration: .4, ease: "expo.in" }, "<")
            .to(pagina(), { y: -20, opacity: .6, duration: .4, ease: "expo.in" }, "<")
            .fromTo(linea, { opacity: 0, scaleX: 1 }, { opacity: 1, duration: .05 }, "-=.05")
            .to(linea, { scaleX: 0, duration: .22, ease: "power3.in" })
            .to(linea, { opacity: 0, duration: .06 });
    }

    // Enlaces internos: apagado CRT y luego navegar.
    document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest("a[href]");
        if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
        var url = new URL(a.href, location.href);
        if (url.origin !== location.origin || !/(\.html|\/)$/.test(url.pathname) || url.hash) return;
        if (!anima()) return;
        e.preventDefault();
        apagar(function () { location.href = a.href; });
    });
    window.addEventListener("pageshow", function (e) {
        if (!e.persisted) return;
        document.querySelectorAll(".crt").forEach(function (c) { c.remove(); });
        if (g) g.set(pagina(), { clearProps: "transform,opacity" });
    });

    //--- OSD de canal (esquina superior, como una TV) --------------------------------
    var osdEl = null, osdTl = null;
    function osdMostrar(texto) {
        if (!anima()) return;
        if (!osdEl) { osdEl = el("div", "osd"); osdEl.setAttribute("aria-hidden", "true"); document.body.appendChild(osdEl); }
        osdEl.textContent = texto;
        if (osdTl) osdTl.kill();
        osdTl = g.timeline()
            .fromTo(osdEl, { opacity: 0 }, { opacity: 1, duration: .2, ease: "steps(3)" })
            .add(function () { descifrar(osdEl, 0, .55); }, 0)
            .to(osdEl, { opacity: 0, duration: .3, ease: "steps(3)" }, "+=1.7");
    }

    //--- Lenis (scroll suave) ---------------------------------------------------------
    var lenis = null;
    if (anima() && window.Lenis) {
        lenis = new window.Lenis({ lerp: .1, wheelMultiplier: 1, anchors: { offset: -130 } });
        if (ST) lenis.on("scroll", ST.update);
        g.ticker.add(function (t) { lenis.raf(t * 1000); });
        g.ticker.lagSmoothing(0);
    }
    function arriba() {
        if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
        else window.scrollTo(0, 0);
    }
    function refrescar() { if (ST) requestAnimationFrame(function () { ST.refresh(); }); }

    //--- Bucle por fotograma: progreso, cabecera compacta y velocidad del scroll -----
    // Rendimiento: solo escribe en el DOM cuando algo cambió, y nunca en <html>
    // (una variable CSS en la raíz recalculaba los estilos de toda la página).
    var puntero = { x: innerWidth / 2, y: innerHeight / 2 };
    var cintillos = [];
    var ultY = -1, vel = 0, progreso = null, cabEl = null, compacta = false, ultSk = 0;
    function bucle() {
        var y = window.scrollY, d = ultY < 0 ? 0 : y - ultY;
        if (d !== 0 || ultY < 0) {
            var max = document.documentElement.scrollHeight - innerHeight;
            if (progreso) progreso.style.transform = "scaleX(" + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ")";
            var quiere = y > 160 && d > 0 ? true : (d < 0 || y < 80 ? false : compacta);
            if (cabEl && quiere !== compacta) {
                compacta = quiere;
                cabEl.classList.toggle("compacta", compacta);
                document.body.classList.toggle("cab-compacta", compacta);
            }
        }
        ultY = y;
        vel += (d - vel) * .14;
        if (Math.abs(vel) < .01) vel = 0;
        if (cintillos.length) {
            var sk = Math.max(-12, Math.min(12, vel * .45));
            if (sk !== ultSk) {
                ultSk = sk;
                var ts = 1 + Math.min(Math.abs(vel) * .28, 9);
                cintillos.forEach(function (c) { c.tw.timeScale(ts); c.skew(sk); });
            }
        }
    }
    if (anima()) g.ticker.add(bucle);
    else window.addEventListener("scroll", bucle, { passive: true });

    // Pausa animaciones continuas cuando su elemento no está en pantalla.
    function siVisible(nodo, alCambiar) {
        if (!nodo || !("IntersectionObserver" in window)) { alCambiar(true); return; }
        new IntersectionObserver(function (es) { alCambiar(es[0].isIntersecting); }, { rootMargin: "120px" }).observe(nodo);
    }

    //--- Toasts ----------------------------------------------------------------------
    var pila = null;
    function toast(msg, tipo, ms) {
        if (!pila) { pila = el("div", "toasts"); pila.setAttribute("role", "status"); document.body.appendChild(pila); }
        ms = ms || (msg.length > 90 ? 7000 : 4200);
        var t = el("div", "toast " + (tipo || ""), "<i></i><div></div><b class='t-prog'></b>");
        t.children[1].textContent = msg;
        t.querySelector(".t-prog").style.animationDuration = ms + "ms";
        pila.appendChild(t);
        if (anima()) {
            g.from(t, { x: 60, opacity: 0, scale: .9, rotate: 2, duration: .8, ease: "expo.out" });
            g.from(t.firstChild, { scale: 0, duration: .6, delay: .2, ease: "back.out(4)" });
        }
        var fuera = function () {
            if (!t.isConnected) return;
            if (anima()) g.to(t, { x: 40, opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: -10, duration: .45, ease: "power3.in", onComplete: function () { t.remove(); } });
            else t.remove();
        };
        t.onclick = fuera;
        setTimeout(fuera, ms);
    }

    //--- Modales (reemplazan alert/confirm/prompt) -------------------------------------
    function modal(contenido, alMontar) {
        return new Promise(function (resolver) {
            var velo = el("div", "velo-modal");
            var caja = el("div", "modal", contenido);
            caja.setAttribute("role", "dialog");
            caja.setAttribute("aria-modal", "true");
            velo.appendChild(caja);
            document.body.appendChild(velo);
            if (lenis) lenis.stop();
            var previo = document.activeElement;
            function cerrar(valor) {
                document.removeEventListener("keydown", tecla);
                var fin = function () {
                    velo.remove();
                    if (lenis) lenis.start();
                    if (previo && previo.focus) previo.focus();
                    resolver(valor);
                };
                if (anima()) {
                    g.to(caja, { y: 24, opacity: 0, scale: .96, rotateX: 12, duration: .28, ease: "power2.in" });
                    g.to(velo, { opacity: 0, duration: .32, onComplete: fin });
                } else fin();
            }
            function tecla(e) { if (e.key === "Escape") cerrar(null); }
            document.addEventListener("keydown", tecla);
            velo.addEventListener("mousedown", function (e) { if (e.target === velo) cerrar(null); });
            if (anima()) {
                g.from(velo, { opacity: 0, duration: .3 });
                g.from(caja, { y: 60, opacity: 0, scale: .9, rotateX: -18, transformPerspective: 900, duration: .85, ease: EXPO });
                g.from(caja.children, { y: 18, opacity: 0, duration: .7, ease: EXPO, stagger: .06, delay: .1 });
            }
            alMontar(caja, cerrar);
        });
    }

    function confirmar(o) {
        return modal(
            "<h3></h3><p></p><div class='acciones'><button type='button' class='secundario' data-n>Cancelar</button>" +
            "<button type='button' class='" + (o.peligro ? "peligro" : "") + "' data-s></button></div>",
            function (caja, cerrar) {
                caja.querySelector("h3").textContent = o.titulo;
                caja.querySelector("p").textContent = o.texto || "";
                caja.querySelector("[data-s]").textContent = o.ok || "Confirmar";
                caja.querySelector("[data-n]").onclick = function () { cerrar(false); };
                caja.querySelector("[data-s]").onclick = function () { cerrar(true); };
                caja.querySelector("[data-s]").focus();
            }).then(function (v) { return v === true; });
    }

    // ir (opcional): { texto, href } añade un botón principal que lleva a otra página.
    function aviso(titulo, texto, ir) {
        var botones = ir
            ? "<button type='button' class='secundario' data-s>Cerrar</button><a class='boton' data-ir></a>"
            : "<button type='button' data-s>Entendido</button>";
        return modal("<h3></h3><p></p><div class='acciones'>" + botones + "</div>",
            function (caja, cerrar) {
                caja.querySelector("h3").textContent = titulo;
                caja.querySelector("p").textContent = texto;
                caja.querySelector("p").style.whiteSpace = "pre-line";
                caja.querySelector("[data-s]").onclick = function () { cerrar(true); };
                var a = caja.querySelector("[data-ir]");
                if (a) {
                    a.href = ir.href;
                    a.innerHTML = esc(ir.texto) + " <span class='flecha'>→</span>";
                    a.focus();
                } else caja.querySelector("[data-s]").focus();
            });
    }

    // Ayuda siempre a mano: explica en tres pasos cómo transmitir.
    function ayuda() {
        if (document.querySelector(".ayuda-flotante")) return;
        var b = el("button", "ayuda-flotante", "<span class='q' aria-hidden='true'>?</span><span class='txt'>¿Cómo transmito?</span>");
        b.type = "button";
        b.setAttribute("aria-label", "¿Cómo transmito? Ver los pasos");
        document.body.appendChild(b);
        var enEmisora = /emisora\.html$/.test(location.pathname);
        b.onclick = function () {
            modal("<h3>¿Cómo transmito mi clase?</h3><p>Son tres pasos y no necesitas cables.</p>" +
                "<ol class='pasos-modal'>" +
                "<li><span>Abre <b>Transmitir</b> (arriba, en el menú) y <b>elige tu laboratorio</b>.</span></li>" +
                "<li><span>Pulsa <b>Compartir mi pantalla</b> y elige la ventana o pantalla que quieres mostrar.</span></li>" +
                "<li><span>Pulsa <b>Transmitir a las TVs</b>. Cuando termines la clase, pulsa <b>Terminar transmisión</b>.</span></li>" +
                "</ol><p style='font-size:15px'>¿Algo no funciona? Comunícate con soporte técnico de tu facultad.</p>" +
                "<div class='acciones'><button type='button' class='secundario' data-s>Cerrar</button>" +
                (enEmisora ? "" : "<a class='boton' href='emisora.html'>Ir a Transmitir <span class='flecha'>→</span></a>") + "</div>",
                function (caja, cerrar) {
                    caja.querySelector("[data-s]").onclick = function () { cerrar(true); };
                    if (anima()) g.from(caja.querySelectorAll(".pasos-modal li"), { x: -24, opacity: 0, duration: .7, ease: EXPO, stagger: .1, delay: .3 });
                    (caja.querySelector("a.boton") || caja.querySelector("[data-s]")).focus();
                });
        };
        if (anima()) {
            g.fromTo(b, { y: 90, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: "back.out(1.6)", delay: retraso(1.4), clearProps: "transform,opacity" });
            g.fromTo(b.querySelector(".q"), { rotate: 0 }, { rotate: 360, duration: .9, ease: "back.out(2)", delay: retraso(2.1) });
        }
    }

    function formulario(o) {
        var html = "<h3></h3><p></p><form><div class='campos'>" + o.campos.map(function (c) {
            return "<label><span class='etiqueta'>" + esc(c.label) + "</span><input name='" + c.id + "'" +
                (c.lista ? " list='" + c.lista + "'" : "") + " value='" + esc(c.valor) + "' /></label>";
        }).join("") + "</div><div class='acciones'><button type='button' class='secundario' data-n>Cancelar</button>" +
            "<button type='submit'>" + esc(o.ok || "Guardar") + "</button></div></form>";
        return modal(html, function (caja, cerrar) {
            caja.querySelector("h3").textContent = o.titulo;
            caja.querySelector("p").textContent = o.texto || "";
            caja.querySelector("[data-n]").onclick = function () { cerrar(null); };
            caja.querySelector("form").onsubmit = function (e) {
                e.preventDefault();
                var r = {};
                o.campos.forEach(function (c) { r[c.id] = caja.querySelector("[name='" + c.id + "']").value; });
                cerrar(r);
            };
            var primero = caja.querySelector("input");
            primero.focus(); primero.select();
        });
    }

    //--- Puntero: luz bajo el cursor y tilt 3D ------------------------------------------
    var TILT = ".lab-card, .tv, .kpi, .ticket";
    if (punteroFino) {
        // Rendimiento: un solo cálculo por fotograma, y todas las lecturas de
        // posición antes de cualquier escritura (evita recalcular el layout).
        var ultimoEv = null, pendiente = false;
        var procesar = function () {
            pendiente = false;
            var e = ultimoEv, tgt = e.target;
            if (!tgt || !tgt.closest) return;
            var t = tgt.closest(".spot"), k = reducido ? null : tgt.closest(TILT);
            var r = t && t.getBoundingClientRect();
            var q = k && (k === t ? r : k.getBoundingClientRect());
            if (t) {
                t.style.setProperty("--mx", (e.clientX - r.left) + "px");
                t.style.setProperty("--my", (e.clientY - r.top) + "px");
            }
            if (k) {
                var nx = (e.clientX - q.left) / q.width - .5, ny = (e.clientY - q.top) / q.height - .5;
                var f = k.classList.contains("kpi") ? 5 : 7;
                k.style.setProperty("--ry", (nx * f).toFixed(2) + "deg");
                k.style.setProperty("--rx", (-ny * f).toFixed(2) + "deg");
            }
        };
        document.addEventListener("pointermove", function (e) {
            puntero.x = e.clientX; puntero.y = e.clientY;
            ultimoEv = e;
            if (!pendiente) { pendiente = true; requestAnimationFrame(procesar); }
        }, { passive: true });
        document.addEventListener("pointerout", function (e) {
            var k = e.target.closest && e.target.closest(TILT);
            if (k && !k.contains(e.relatedTarget)) { k.style.setProperty("--rx", "0deg"); k.style.setProperty("--ry", "0deg"); }
        });
        // La etiqueta "Canal 0x" de cada laboratorio se resintoniza al pasar por encima
        document.addEventListener("pointerover", function (e) {
            var c = e.target.closest && e.target.closest(".lab-card");
            if (c && !c.contains(e.relatedTarget)) descifrar(c.querySelector(".idx"), 0, .45);
        });
    }

    function magnetico(boton, fuerza) {
        if (!punteroFino || !anima() || !boton) return;
        fuerza = fuerza || .3;
        var mx = g.quickTo(boton, "x", { duration: .6, ease: "elastic.out(1, .4)" });
        var my = g.quickTo(boton, "y", { duration: .6, ease: "elastic.out(1, .4)" });
        boton.addEventListener("pointermove", function (e) {
            if (boton.disabled) return;
            var r = boton.getBoundingClientRect();
            mx((e.clientX - r.left - r.width / 2) * fuerza);
            my((e.clientY - r.top - r.height / 2) * fuerza);
        });
        boton.addEventListener("pointerleave", function () { mx(0); my(0); });
    }

    // Texto del botón que "rueda" al pasar el cursor (copia que sube desde abajo).
    function rodar(boton) {
        if (!boton || !anima() || boton.querySelector(".rodar")) return;
        var html = boton.innerHTML.trim();
        boton.innerHTML = "<span class='rodar'><span class='r1'>" + html + "</span><span class='r2' aria-hidden='true'>" + html + "</span></span>";
    }

    //--- Odómetro ----------------------------------------------------------------------
    function odometro(nodo, valor) {
        if (!nodo) return;
        valor = Math.max(0, Math.round(Number(valor) || 0));
        var txt = String(valor);
        nodo.setAttribute("aria-label", txt);
        if (!anima()) { nodo.textContent = txt; return; }
        var cols = nodo.querySelectorAll(".odo-col");
        if (cols.length !== txt.length) {
            nodo.textContent = "";
            for (var i = 0; i < txt.length; i++) {
                var col = el("span", "odo-col", "<span class='odo-tira'><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span></span>");
                col.setAttribute("aria-hidden", "true");
                nodo.appendChild(col);
            }
            cols = nodo.querySelectorAll(".odo-col");
            void nodo.offsetWidth;
        }
        var aplicar = function () {
            var extra = retraso(0);
            cols.forEach(function (c, j) {
                var tira = c.firstChild;
                tira.style.transitionDelay = (extra + j * .08) + "s";
                tira.style.transform = "translateY(" + (-Number(txt[j]) * 10) + "%)";
            });
        };
        if (!nodo._visto && ST) {
            nodo._valor = valor;
            if (!nodo._st) nodo._st = ST.create({
                trigger: nodo, start: "top 94%", once: true,
                onEnter: function () { nodo._visto = true; odometro(nodo, nodo._valor); }
            });
            return;
        }
        requestAnimationFrame(aplicar);
    }

    //--- Entradas ----------------------------------------------------------------------
    function alVer(nodo, fn, inicio) {
        if (!ST || !nodo) { fn(); return; }
        ST.create({ trigger: nodo, start: inicio || "top 90%", once: true, onEnter: fn });
    }

    // Stagger irregular: cada elemento llega un poco distinto, como compuesto a mano.
    function entrada(nodos, o) {
        if (!anima()) return;
        nodos = g.utils.toArray(nodos);
        if (!nodos.length) return;
        o = o || {};
        // Las transiciones CSS se apagan ANTES de leer los valores finales, para
        // que GSAP no lea un estado a medio camino.
        bloquear(nodos);
        var tw = g.from(nodos, {
            onComplete: function () { liberar(nodos); },
            y: o.y == null ? 46 : o.y, x: o.x || 0, opacity: o.opacity == null ? 0 : o.opacity,
            rotate: o.rotate || 0, scale: o.scale == null ? 1 : o.scale,
            duration: o.duracion || 1.05, ease: o.ease || EXPO, paused: !!o.scroll,
            delay: o.scroll ? 0 : retraso(o.delay),
            stagger: function (i) { return i * (o.paso || .07) + (i % 3 === 1 ? .03 : 0) + (i % 4 === 3 ? .05 : 0); },
            clearProps: "transform,opacity"
        });
        if (o.scroll) alVer(nodos[0], function () { g.delayedCall(retraso(o.delay), function () { tw.play(); }); });
        return tw;
    }

    function titular(nodo, delay, senal) {
        if (!anima() || !nodo) return;
        if (!window.SplitText) { g.from(nodo, { y: 40, opacity: 0, duration: 1, ease: EXPO, delay: retraso(delay) }); return; }
        var s = new window.SplitText(nodo, { type: "chars,lines", linesClass: "linea", charsClass: "char", mask: "lines" });
        g.from(s.chars, {
            yPercent: 118, rotate: 7, duration: 1.25, ease: EXPO, delay: retraso(delay == null ? .1 : delay),
            stagger: { each: .022, from: "start" }
        });
        if (punteroFino) s.chars.forEach(function (c) {
            c.addEventListener("pointerenter", function () {
                if (g.isTweening(c)) return;
                g.to(c, { yPercent: -16, rotate: -4, duration: .22, ease: "power2.out", yoyo: true, repeat: 1 });
            });
        });
        if (senal) {
            // Cada pocos segundos una "pasada de señal" recorre la palabra resaltada.
            var luzes = nodo.querySelectorAll("em .char");
            if (luzes.length) {
                g.set(luzes, { textShadow: "0 0 0px rgba(197,216,46,0)" });
                g.timeline({ repeat: -1, repeatDelay: 4.2, delay: retraso(delay) + 2.4 })
                    .to(luzes, { color: "#93a816", textShadow: "0 0 26px rgba(197,216,46,.9)", y: -5, duration: .18, stagger: .05, ease: "power1.out" })
                    .to(luzes, { color: "#1f9a55", textShadow: "0 0 0px rgba(197,216,46,0)", y: 0, duration: .6, stagger: .05, ease: "power2.out" }, .2);
            }
        }
        return s;
    }

    // Encabezados de sección: la cápsula verde entra desde el borde, el título
    // sube letra a letra y la etiqueta se descifra.
    function secciones() {
        if (!anima()) return;
        document.querySelectorAll(".seccion-cab").forEach(function (cab) {
            var et = cab.querySelector(".etiqueta"), h = cab.querySelector("h2"), p = cab.querySelector(":scope > p");
            var tl = g.timeline({ paused: true });
            if (h && h.classList.contains("capsula")) {
                // La cápsula entra deslizándose desde el borde izquierdo de la ventana.
                var fuera = -(h.getBoundingClientRect().right + 40);
                tl.fromTo(h, { x: fuera }, { x: 0, duration: 1, ease: "expo.out", clearProps: "transform" }, 0);
            }
            if (h && window.SplitText) {
                var s = new window.SplitText(h, { type: "chars,lines", linesClass: "linea", charsClass: "char", mask: "lines" });
                tl.from(s.chars, { yPercent: 120, rotate: 8, duration: 1, ease: EXPO, stagger: .025 }, h.classList.contains("capsula") ? .35 : 0);
            }
            if (p) tl.from(p, { y: 26, opacity: 0, duration: .9, ease: EXPO }, .15);
            if (et) tl.add(function () { descifrar(et, 0, .8); }, 0);
            alVer(cab, function () { g.delayedCall(retraso(0), function () { tl.play(); }); }, "top 88%");
        });
    }

    //--- Efectos de pantalla (CRT) -------------------------------------------------------
    function encenderPantalla(nodo, d) {
        if (!anima() || !nodo) return;
        bloquear(nodo);
        protegido(nodo, g.timeline({ delay: d || 0 })
            .fromTo(nodo, { scaleY: .012, scaleX: .35, filter: "brightness(5)" }, { scaleX: 1, duration: .18, ease: "power2.out" })
            .to(nodo, { scaleY: 1, duration: .6, ease: EXPO })
            .to(nodo, { filter: "brightness(1)", duration: .7, ease: "power2.out", clearProps: "transform,filter" }, "<"));
    }
    function apagarPantalla(nodo, alFinal) {
        if (!anima() || !nodo) { if (alFinal) alFinal(); return; }
        protegido(nodo, g.timeline({ onComplete: alFinal })
            .to(nodo, { scaleY: .012, filter: "brightness(4)", duration: .22, ease: "power3.in" })
            .to(nodo, { scaleX: 0, duration: .16, ease: "power3.in" })
            .set(nodo, { clearProps: "transform,filter", opacity: 0 })
            .to(nodo, { opacity: 1, duration: .4, ease: "power2.out", clearProps: "opacity" }));
    }
    function glitch(nodo) {
        if (!anima() || !nodo) return;
        protegido(nodo, g.timeline()
            .to(nodo, { x: -7, skewX: 10, filter: "hue-rotate(90deg) saturate(3)", duration: .05 })
            .to(nodo, { x: 6, skewX: -5, filter: "hue-rotate(-70deg) contrast(1.8)", duration: .05 })
            .to(nodo, { x: -3, skewX: 3, filter: "invert(1)", duration: .04 })
            .to(nodo, { x: 2, skewX: 0, filter: "hue-rotate(0deg) contrast(1)", duration: .05 })
            .to(nodo, { x: 0, duration: .1, clearProps: "transform,filter" }));
    }
    // Estática de TV en un canvas diminuto escalado (barato: 160×90, ~20 fps).
    function ruido(canvas, activo) {
        if (!canvas || !g || reducido) return;
        var ctx = canvas.getContext("2d"), w = canvas.width = 160, h = canvas.height = 90;
        var img = ctx.createImageData(w, h), f = 0;
        g.ticker.add(function () {
            if (++f % 3 || !activo()) return;
            var d = img.data;
            for (var i = 0; i < d.length; i += 4) {
                var v = (Math.random() * 255) | 0;
                d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
            }
            ctx.putImageData(img, 0, 0);
        });
    }
    // Cuenta regresiva de película antes de salir al aire.
    function cuentaRegresiva(cont) {
        if (!anima() || !cont) return;
        var c = el("div", "cuenta", "<div class='cuenta-aro'></div><div class='cuenta-cruz'></div><span class='cuenta-num'>3</span>");
        c.setAttribute("aria-hidden", "true");
        cont.appendChild(c);
        var num = c.querySelector(".cuenta-num"), aro = c.querySelector(".cuenta-aro");
        var tl = g.timeline({ onComplete: function () { c.remove(); } });
        tl.from(c, { opacity: 0, duration: .12 });
        ["3", "2", "1"].forEach(function (n) {
            tl.add(function () { num.textContent = n; })
                .fromTo(aro, { "--ang": "0deg" }, { "--ang": "360deg", duration: .44, ease: "none" }, "<")
                .fromTo(num, { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: .26, ease: EXPO }, "<");
        });
        tl.add(function () { num.textContent = "AL AIRE"; c.classList.add("fin"); })
            .fromTo(num, { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: .4, ease: EXPO })
            .to(c, { opacity: 0, duration: .4, ease: "power2.in" }, "+=.4");
    }

    //--- Transiciones de canal ----------------------------------------------------------
    // La tarjeta clicada crece hasta cubrir la pantalla; debajo se monta la nueva vista.
    function expandir(origen, titulo, osd, claro, alCubrir) {
        if (!anima() || !origen) { alCubrir(); return; }
        var r = origen.getBoundingClientRect(), W = innerWidth, H = innerHeight;
        var capa = el("div", "zoom-canal" + (claro ? " claro" : ""), "<div class='zc-carta'></div><div class='zc-osd'></div><div class='zc-titulo'></div>");
        capa.setAttribute("aria-hidden", "true");
        capa.querySelector(".zc-osd").textContent = osd;
        capa.querySelector(".zc-titulo").textContent = titulo;
        document.body.appendChild(capa);
        var ini = "inset(" + r.top + "px " + (W - r.right) + "px " + (H - r.bottom) + "px " + r.left + "px round 18px)";
        g.timeline()
            .fromTo(capa, { clipPath: ini }, { clipPath: "inset(0px 0px 0px 0px round 0px)", duration: .78, ease: "expo.inOut" })
            .from(capa.querySelector(".zc-titulo"), { yPercent: 70, opacity: 0, duration: .55, ease: EXPO }, "-=.4")
            .add(function () { descifrar(capa.querySelector(".zc-osd"), 0, .45); }, "<")
            .add(alCubrir)
            .to(capa, { clipPath: "inset(0px 0px 100% 0px round 0px)", duration: .75, ease: "expo.inOut" }, "+=.12")
            .add(function () { capa.remove(); osdMostrar(osd); });
    }
    function cambioCanal(osd, titulo, alCubrir) {
        if (!anima()) { alCubrir(); return; }
        var capa = el("div", "zoom-canal", "<div class='zc-carta'></div><div class='zc-osd'></div><div class='zc-titulo'></div>");
        capa.setAttribute("aria-hidden", "true");
        capa.querySelector(".zc-osd").textContent = osd;
        capa.querySelector(".zc-titulo").textContent = titulo;
        document.body.appendChild(capa);
        g.timeline()
            .fromTo(capa, { clipPath: "inset(100% 0px 0px 0px)" }, { clipPath: "inset(0% 0px 0px 0px)", duration: .55, ease: "expo.inOut" })
            .from(capa.querySelector(".zc-titulo"), { yPercent: 60, opacity: 0, duration: .5, ease: EXPO }, "-=.25")
            .add(function () { descifrar(capa.querySelector(".zc-osd"), 0, .4); }, "<")
            .add(alCubrir)
            .to(capa, { clipPath: "inset(0% 0px 100% 0px)", duration: .7, ease: "expo.inOut" }, "+=.1")
            .add(function () { capa.remove(); osdMostrar(osd); });
    }

    //--- Tarjetas de TV ------------------------------------------------------------------
    function cambioEstado(card, antes, ahora) {
        if (!anima() || !card) return;
        var p = card.querySelector(".tv-pantalla") || card;
        if (ahora === "offline") apagarPantalla(p);
        else if (antes === "offline") encenderPantalla(p);
        else glitch(p);
        var halo = el("span", "onda-sel");
        card.appendChild(halo);
        g.fromTo(halo, { scale: .9, opacity: 1 }, { scale: 1.12, opacity: 0, duration: 1.2, ease: EXPO, onComplete: function () { halo.remove(); } });
    }
    function marcar(card, on, d) {
        if (!anima() || !card) return;
        var svg = card.querySelector(".tv-check svg");
        if (on && svg) protegido(svg, g.fromTo(svg, { strokeDashoffset: 22 }, { strokeDashoffset: 0, duration: .5, delay: d || 0, ease: EXPO, clearProps: "strokeDashoffset" }));
        var chk = card.querySelector(".tv-check");
        if (chk) protegido(chk, g.fromTo(chk, { scale: on ? .4 : 1.3 }, { scale: on ? 1.08 : 1, duration: .6, delay: d || 0, ease: "back.out(3)", clearProps: "scale" }));
        protegido(card, g.fromTo(card, { scale: on ? .96 : 1.02 }, { scale: 1, duration: .8, delay: d || 0, ease: "elastic.out(1, .45)", clearProps: "scale" }));
        if (on) {
            var halo = el("span", "onda-sel");
            card.appendChild(halo);
            g.fromTo(halo, { scale: .96, opacity: .9 }, { scale: 1.08, opacity: 0, duration: .8, delay: d || 0, ease: EXPO, onComplete: function () { halo.remove(); } });
        }
    }

    //--- Cintillo de noticias -------------------------------------------------------------
    function cintillo(pistas, partes) {
        var firma = partes.join("|");
        pistas.forEach(function (p, k) {
            if (!p || p._firma === firma) return;
            p._firma = firma;
            var grupo = partes.map(function (t) { return "<span class='ci'>" + esc(t) + "</span><i class='cs'>●</i>"; }).join("");
            var mitad = grupo + grupo + grupo;
            p.innerHTML = "<div class='cm'>" + mitad + "</div><div class='cm'>" + mitad + "</div>";
            if (!p._tw && anima()) {
                var tw = p._tw = k % 2
                    ? g.fromTo(p, { xPercent: -50 }, { xPercent: 0, ease: "none", duration: 70, repeat: -1 })
                    : g.to(p, { xPercent: -50, ease: "none", duration: 60, repeat: -1 });
                cintillos.push({ tw: tw, skew: g.quickSetter(p, "skewX", "deg") });
                // Rendimiento: se detiene cuando no está en pantalla.
                siVisible(p.closest(".cintillos") || p, function (v) { v ? tw.resume() : tw.pause(); });
            }
        });
    }

    //--- Diagrama de señal: 1 emisora → N pantallas ----------------------------------------
    var NS = "http://www.w3.org/2000/svg";
    function svgEl(tag, at) {
        var e = document.createElementNS(NS, tag);
        for (var k in at) e.setAttribute(k, at[k]);
        return e;
    }
    function onda(contenedor) {
        var W = 500, H = 440, MAX = 8;
        var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Diagrama de la señal hacia las pantallas" });
        var gLin = svgEl("g", {}), gNod = svgEl("g", {});
        svg.appendChild(gLin); svg.appendChild(gNod);
        contenedor.appendChild(svg);
        var firma = "", pulsos = [], tick = null, visible = true;
        siVisible(contenedor, function (v) { visible = v; });

        // Parallax por capas con el cursor: las líneas se mueven menos que los nodos.
        if (punteroFino && anima()) {
            var lx = g.quickTo(gLin, "x", { duration: 1, ease: "power3" }), ly = g.quickTo(gLin, "y", { duration: 1, ease: "power3" });
            var nx = g.quickTo(gNod, "x", { duration: 1, ease: "power3" }), ny = g.quickTo(gNod, "y", { duration: 1, ease: "power3" });
            window.addEventListener("pointermove", function (e) {
                if (!visible) return;
                var fx = e.clientX / innerWidth - .5, fy = e.clientY / innerHeight - .5;
                lx(fx * 8); ly(fy * 8); nx(fx * 20); ny(fy * 14);
            }, { passive: true });
        }

        function dibujar(tvs) {
            var lista = tvs.slice(0, MAX);
            var extra = tvs.length - lista.length;
            var nueva = lista.map(function (t) { return t.deviceId + ":" + t.estado; }).join("|") + "+" + extra;
            if (nueva === firma) return;
            var primera = !firma;
            firma = nueva;
            gLin.innerHTML = ""; gNod.innerHTML = "";
            pulsos = [];
            var fantasma = !lista.length;
            if (fantasma) lista = [1, 2, 3, 4].map(function (i) { return { deviceId: "TV-0" + i, estado: "x" }; });
            var n = lista.length, sx = 70, sy = H / 2;
            var alto = Math.min(H - 60, n * 62), y0 = (H - alto) / 2, paso = n > 1 ? alto / (n - 1) : 0;
            lista.forEach(function (t, i) {
                var ty = n > 1 ? y0 + paso * i : sy, tx = W - 108;
                var d = "M" + (sx + 46) + "," + sy + " C" + (sx + 190) + "," + sy + " " + (tx - 150) + "," + ty + " " + tx + "," + ty;
                gLin.appendChild(svgEl("path", { d: d, "class": "base" }));
                if (t.estado === "streaming" || t.estado === "online") {
                    var f = svgEl("path", { d: d, "class": "flujo" + (t.estado === "online" ? " lento" : "") });
                    gLin.appendChild(f);
                    var vivo = t.estado === "streaming";
                    pulsos.push({ p: f, l: 0, v: vivo ? .0045 + (i % 3) * .0012 : .0018 + (i % 2) * .0006, o: (i * .17) % 1, tenue: !vivo });
                    if (vivo) pulsos.push({ p: f, l: 0, v: .0045 + (i % 3) * .0012, o: ((i * .17) + .5) % 1 });
                }
                var cls = t.estado === "streaming" ? "vivo" : t.estado === "online" ? "libre" : t.estado === "offline" ? "caido" : "";
                var gN = svgEl("g", { "class": "nodo-tv " + cls, transform: "translate(" + tx + "," + (ty - 15) + ")" });
                gN.appendChild(svgEl("rect", { width: 52, height: 30, rx: 5 }));
                gN.appendChild(svgEl("rect", { x: 20, y: 32, width: 12, height: 3, rx: 1, style: "stroke:none;fill:var(--linea-fuerte)" }));
                var tt = svgEl("text", { x: 62, y: 19 });
                tt.textContent = fantasma ? "· · ·" : String(t.deviceId).slice(0, 12);
                gN.appendChild(tt);
                gNod.appendChild(gN);
            });
            if (extra > 0) {
                var mas = svgEl("text", { x: W - 108, y: H - 6, style: "font:500 10px var(--f-mono);fill:var(--apagado)" });
                mas.textContent = "+" + extra + " pantallas más";
                gNod.appendChild(mas);
            }
            var fu = svgEl("g", { "class": "fuente", transform: "translate(" + (sx - 46) + "," + (sy - 26) + ")" });
            fu.appendChild(svgEl("circle", { "class": "halo", cx: 46, cy: 26, r: 34 }));
            fu.appendChild(svgEl("circle", { "class": "halo", cx: 46, cy: 26, r: 34 }));
            fu.appendChild(svgEl("rect", { width: 92, height: 52, rx: 12 }));
            var ft = svgEl("text", { x: 46, y: 31, "text-anchor": "middle" });
            ft.textContent = "TU PC";
            fu.appendChild(ft);
            gNod.appendChild(fu);
            pulsos.forEach(function (q) {
                q.l = q.p.getTotalLength();
                q.c = svgEl("circle", { r: q.tenue ? 2.6 : 4, "class": "pulso" + (q.tenue ? " tenue" : "") });
                gNod.appendChild(q.c);
            });
            if (anima()) {
                if (primera) {
                    var dl = retraso(.3);
                    g.from(gLin.querySelectorAll(".base"), { strokeDasharray: 600, strokeDashoffset: 600, duration: 1.6, ease: "power3.inOut", stagger: .08, delay: dl + .2 });
                    g.from(gNod.querySelectorAll(".nodo-tv"), { opacity: 0, x: 30, duration: 1, ease: EXPO, stagger: .07, delay: dl + .6 });
                    g.from(fu, { scale: .5, opacity: 0, transformOrigin: "50% 50%", duration: 1.1, ease: "back.out(1.8)", delay: dl });
                } else {
                    g.from(gNod.querySelectorAll(".nodo-tv"), { scale: .7, opacity: .2, transformOrigin: "0% 50%", duration: .8, ease: "back.out(2)", stagger: .04 });
                }
            }
            arrancar();
        }

        function arrancar() {
            if (tick || !g || reducido) return;
            tick = function () {
                if (!visible) return; // Rendimiento: nada que calcular fuera de pantalla.
                for (var i = 0; i < pulsos.length; i++) {
                    var q = pulsos[i];
                    q.o = (q.o + q.v) % 1;
                    var e = q.o < .5 ? 2 * q.o * q.o : 1 - Math.pow(-2 * q.o + 2, 2) / 2;
                    var pt = q.p.getPointAtLength(e * q.l);
                    q.c.setAttribute("cx", pt.x); q.c.setAttribute("cy", pt.y);
                    q.c.setAttribute("opacity", Math.sin(q.o * Math.PI) * (q.tenue ? .6 : 1));
                }
            };
            g.ticker.add(tick);
        }
        return { set: dibujar };
    }

    //--- Piezas de la página: nav, pie, parallax ------------------------------------------
    function navLuz() {
        var nav = document.querySelector(".nav");
        if (!nav || !anima()) return;
        var l = el("span", "nav-luz");
        nav.insertBefore(l, nav.firstChild);
        nav.querySelectorAll("a").forEach(function (a) {
            a.addEventListener("pointerenter", function () {
                var actual = a.getAttribute("aria-current");
                if (Number(g.getProperty(l, "opacity")) < .05) g.set(l, { x: a.offsetLeft, width: a.offsetWidth });
                g.to(l, { x: a.offsetLeft, width: a.offsetWidth, opacity: actual ? 0 : 1, duration: .55, ease: EXPO });
            });
        });
        nav.addEventListener("pointerleave", function () { g.to(l, { opacity: 0, duration: .35 }); });
    }

    function pie() {
        var main = document.querySelector("main");
        if (!main || document.querySelector(".pie")) return;
        var f = el("footer", "pie",
            "<div class='pie-franja'></div><div class='pie-int'>" +
            "<div class='pie-fila'><span class='etiqueta'><b>●</b> Universidad Mesoamericana · Sistema de Pantallas</span><span class='etiqueta pie-reloj'></span></div>" +
            "<div class='pie-marca' aria-hidden='true'>UMES</div>" +
            "<div class='pie-fila'><span>¿Algo no funciona? Comunícate con soporte técnico de tu facultad.</span><span>Guatemala</span></div></div>");
        main.after(f);
        var reloj = f.querySelector(".pie-reloj");
        var tic = function () { reloj.textContent = new Date().toLocaleTimeString("es", { hour12: false }); };
        tic(); setInterval(tic, 1000);
        if (anima() && window.SplitText && ST) {
            var s = new window.SplitText(f.querySelector(".pie-marca"), { type: "chars", charsClass: "char" });
            g.from(s.chars, {
                yPercent: 105, rotate: 10, ease: "none", stagger: .06,
                scrollTrigger: { trigger: f, start: "top 98%", end: "bottom bottom", scrub: .8 }
            });
        }
    }

    function heroParallax() {
        var hero = document.querySelector(".hero");
        if (!hero || !ST || !anima()) return;
        var st = { trigger: hero, start: "top top", end: "bottom top", scrub: .6 };
        g.to(".onda-caja", { yPercent: -12, ease: "none", scrollTrigger: st });
        g.to(".hero-texto", { yPercent: 18, opacity: .2, ease: "none", scrollTrigger: Object.assign({}, st) });
    }

    function cabecera() {
        cabEl = document.querySelector(".cabecera");
        var nav = document.querySelector(".cab-nav");
        if (nav) {
            progreso = el("span", "progreso");
            progreso.setAttribute("aria-hidden", "true");
            nav.appendChild(progreso);
        }
        var ll = document.querySelector(".llave");
        if (ll) {
            var b = ll.querySelector(".llave-boton");
            b.onclick = function (e) {
                e.stopPropagation();
                ll.classList.toggle("abierta");
                b.setAttribute("aria-expanded", ll.classList.contains("abierta"));
                if (ll.classList.contains("abierta")) setTimeout(function () { ll.querySelector("input").focus(); }, 60);
            };
            document.addEventListener("click", function (e) { if (!ll.contains(e.target)) ll.classList.remove("abierta"); });
        }
    }

    // Al enfocar un campo, su etiqueta se "resintoniza".
    document.addEventListener("focusin", function (e) {
        var lab = e.target.closest && e.target.closest("label");
        if (lab && e.target.matches("input")) descifrar(lab.querySelector(".etiqueta"), 0, .45);
    });

    function copiar(texto) {
        var ok = function () { toast("Copiado al portapapeles", "ok", 2200); };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(texto).then(ok, function () { respaldo(); });
        } else respaldo();
        function respaldo() {
            var ta = el("textarea"); ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select();
            try { document.execCommand("copy"); ok(); } catch (e) { toast("No se pudo copiar", "error"); }
            ta.remove();
        }
    }

    function hace(fecha) {
        if (!fecha) return "nunca conectada";
        var s = Math.round((Date.now() - new Date(fecha).getTime()) / 1000);
        if (isNaN(s)) return String(fecha);
        if (s < 10) return "ahora mismo";
        if (s < 60) return "hace " + s + " s";
        if (s < 3600) return "hace " + Math.round(s / 60) + " min";
        if (s < 86400) return "hace " + Math.round(s / 3600) + " h";
        return "hace " + Math.round(s / 86400) + " d";
    }

    //--- Arranque ---------------------------------------------------------------------------
    encender();
    document.addEventListener("DOMContentLoaded", function () {
        cabecera();
        navLuz();
        pie();
        ayuda();
        secciones();
        heroParallax();
        document.querySelectorAll("[data-rodar]").forEach(rodar);
        refrescar();
    });

    window.UI = {
        gsap: g, anima: anima, retraso: retraso, protegido: protegido, toast: toast, confirmar: confirmar, aviso: aviso, formulario: formulario,
        magnetico: magnetico, rodar: rodar, contar: odometro, odometro: odometro, entrada: entrada, titular: titular,
        descifrar: descifrar, onda: onda, cintillo: cintillo, osd: osdMostrar, expandir: expandir, cambioCanal: cambioCanal,
        cambioEstado: cambioEstado, marcar: marcar, encenderPantalla: encenderPantalla, apagarPantalla: apagarPantalla,
        glitch: glitch, ruido: ruido, cuentaRegresiva: cuentaRegresiva, arriba: arriba, refrescar: refrescar,
        copiar: copiar, hace: hace, esc: esc
    };
})();
