// Capa visual compartida: toasts, modales, spotlight, contadores, entradas
// animadas y el diagrama de señal del hero. Solo presentación: no toca la API.
(function () {
    "use strict";
    var g = window.gsap;
    var reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var punteroFino = window.matchMedia("(pointer: fine)").matches;
    var EXPO = "expo.out";

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
    function anima() { return !!g && !reducido; }

    //--- Toasts ----------------------------------------------------------------
    var pila = null;
    function toast(msg, tipo, ms) {
        if (!pila) { pila = el("div", "toasts"); pila.setAttribute("role", "status"); document.body.appendChild(pila); }
        var t = el("div", "toast " + (tipo || ""), "<i></i><div></div>");
        t.lastChild.textContent = msg;
        pila.appendChild(t);
        if (anima()) g.from(t, { x: 40, opacity: 0, scale: .96, duration: .7, ease: EXPO });
        var fuera = function () {
            if (anima()) g.to(t, { x: 30, opacity: 0, duration: .35, ease: "power2.in", onComplete: function () { t.remove(); } });
            else t.remove();
        };
        t.onclick = fuera;
        setTimeout(fuera, ms || (msg.length > 90 ? 7000 : 4200));
    }

    //--- Modales (reemplazan alert/confirm/prompt) -------------------------------
    function modal(contenido, alMontar) {
        return new Promise(function (resolver) {
            var velo = el("div", "velo-modal");
            var caja = el("div", "modal", contenido);
            caja.setAttribute("role", "dialog");
            caja.setAttribute("aria-modal", "true");
            velo.appendChild(caja);
            document.body.appendChild(velo);
            var previo = document.activeElement;
            function cerrar(valor) {
                document.removeEventListener("keydown", tecla);
                var fin = function () { velo.remove(); if (previo && previo.focus) previo.focus(); resolver(valor); };
                if (anima()) {
                    g.to(caja, { y: 16, opacity: 0, scale: .97, duration: .25, ease: "power2.in" });
                    g.to(velo, { opacity: 0, duration: .3, onComplete: fin });
                } else fin();
            }
            function tecla(e) { if (e.key === "Escape") cerrar(null); }
            document.addEventListener("keydown", tecla);
            velo.addEventListener("mousedown", function (e) { if (e.target === velo) cerrar(null); });
            if (anima()) {
                g.from(velo, { opacity: 0, duration: .3 });
                g.from(caja, { y: 34, opacity: 0, scale: .95, rotate: -1.2, duration: .7, ease: EXPO });
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

    function aviso(titulo, texto) {
        return modal("<h3></h3><p></p><div class='acciones'><button type='button' data-s>Entendido</button></div>",
            function (caja, cerrar) {
                caja.querySelector("h3").textContent = titulo;
                caja.querySelector("p").textContent = texto;
                caja.querySelector("p").style.whiteSpace = "pre-line";
                caja.querySelector("[data-s]").onclick = function () { cerrar(true); };
                caja.querySelector("[data-s]").focus();
            });
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

    //--- Spotlight y magnetismo -------------------------------------------------
    if (punteroFino) {
        document.addEventListener("pointermove", function (e) {
            var s = e.target.closest && e.target.closest(".spot");
            if (!s) return;
            var r = s.getBoundingClientRect();
            s.style.setProperty("--mx", (e.clientX - r.left) + "px");
            s.style.setProperty("--my", (e.clientY - r.top) + "px");
        }, { passive: true });
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

    //--- Números que ruedan ------------------------------------------------------
    function contar(nodo, valor) {
        if (!nodo) return;
        var previo = Number(nodo.dataset.v || 0);
        nodo.dataset.v = valor;
        if (!anima() || previo === valor) { nodo.textContent = valor; return; }
        var o = { v: previo };
        g.to(o, { v: valor, duration: 1.1, ease: "power3.out", onUpdate: function () { nodo.textContent = Math.round(o.v); } });
    }

    //--- Entradas ----------------------------------------------------------------
    // Stagger irregular: cada elemento llega un poco distinto, como compuesto a mano.
    function entrada(nodos, o) {
        if (!anima()) return;
        nodos = g.utils.toArray(nodos);
        if (!nodos.length) return;
        o = o || {};
        g.from(nodos, {
            y: o.y == null ? 46 : o.y, opacity: 0, rotate: o.rotate || 0, scale: o.scale || 1,
            duration: o.duracion || 1.05, ease: EXPO, delay: o.delay || 0,
            stagger: function (i) { return i * (o.paso || .07) + (i % 3 === 1 ? .03 : 0) + (i % 4 === 3 ? .05 : 0); },
            clearProps: "transform,opacity"
        });
    }

    function titular(nodo, delay) {
        if (!anima() || !nodo) return;
        if (window.SplitText) {
            g.registerPlugin(window.SplitText);
            var s = new window.SplitText(nodo, { type: "chars,lines", linesClass: "linea", charsClass: "char", mask: "lines" });
            g.from(s.chars, {
                yPercent: 118, rotate: 6, duration: 1.25, ease: "expo.out", delay: delay || .1,
                stagger: { each: .022, from: "start" }
            });
        } else {
            g.from(nodo, { y: 40, opacity: 0, duration: 1, ease: EXPO, delay: delay || 0 });
        }
    }

    //--- Diagrama de señal: 1 emisora → N pantallas ------------------------------
    // Cada nodo es una TV real; el flujo de la línea refleja su estado.
    var NS = "http://www.w3.org/2000/svg";
    function svgEl(tag, at) {
        var e = document.createElementNS(NS, tag);
        for (var k in at) e.setAttribute(k, at[k]);
        return e;
    }
    function onda(contenedor) {
        var W = 500, H = 440, MAX = 8;
        var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Diagrama de la señal hacia las pantallas" });
        contenedor.appendChild(svg);
        var firma = "", pulsos = [], tick = null;

        function dibujar(tvs) {
            var lista = tvs.slice(0, MAX);
            var extra = tvs.length - lista.length;
            var nueva = lista.map(function (t) { return t.deviceId + ":" + t.estado; }).join("|") + "+" + extra;
            if (nueva === firma) return;
            var primera = !firma;
            firma = nueva;
            svg.innerHTML = "";
            pulsos = [];
            var fantasma = !lista.length;
            if (fantasma) lista = [{}, {}, {}, {}].map(function (x, i) { return { deviceId: "TV-0" + (i + 1), estado: "x" }; });
            var n = lista.length, sx = 70, sy = H / 2;
            var alto = Math.min(H - 60, n * 62), y0 = (H - alto) / 2, paso = n > 1 ? alto / (n - 1) : 0;
            var capaL = svgEl("g", {}), capaN = svgEl("g", {});
            svg.appendChild(capaL); svg.appendChild(capaN);
            lista.forEach(function (t, i) {
                var ty = n > 1 ? y0 + paso * i : sy, tx = W - 108;
                var d = "M" + (sx + 46) + "," + sy + " C" + (sx + 190) + "," + sy + " " + (tx - 150) + "," + ty + " " + tx + "," + ty;
                capaL.appendChild(svgEl("path", { d: d, "class": "base" }));
                if (t.estado === "streaming" || t.estado === "online") {
                    var f = svgEl("path", { d: d, "class": "flujo" + (t.estado === "online" ? " lento" : "") });
                    capaL.appendChild(f);
                    if (t.estado === "streaming") pulsos.push({ p: f, l: 0, v: .0045 + (i % 3) * .0012, o: (i * .17) % 1 });
                }
                var cls = t.estado === "streaming" ? "vivo" : t.estado === "online" ? "libre" : t.estado === "offline" ? "caido" : "";
                var gN = svgEl("g", { "class": "nodo-tv " + cls, transform: "translate(" + tx + "," + (ty - 15) + ")" });
                gN.appendChild(svgEl("rect", { width: 52, height: 30, rx: 5 }));
                gN.appendChild(svgEl("rect", { x: 20, y: 32, width: 12, height: 3, rx: 1, style: "stroke:none;fill:var(--linea-fuerte)" }));
                var tt = svgEl("text", { x: 62, y: 19 });
                tt.textContent = fantasma ? "· · ·" : String(t.deviceId).slice(0, 12);
                gN.appendChild(tt);
                capaN.appendChild(gN);
            });
            if (extra > 0) {
                var mas = svgEl("text", { x: W - 108, y: H - 6, "class": "etq" , style: "font:500 10px var(--f-mono);fill:var(--apagado)" });
                mas.textContent = "+" + extra + " pantallas más";
                capaN.appendChild(mas);
            }
            // Fuente: la laptop que emite
            var fu = svgEl("g", { "class": "fuente", transform: "translate(" + (sx - 46) + "," + (sy - 26) + ")" });
            fu.appendChild(svgEl("circle", { "class": "halo", cx: 46, cy: 26, r: 34 }));
            fu.appendChild(svgEl("circle", { "class": "halo", cx: 46, cy: 26, r: 34 }));
            fu.appendChild(svgEl("rect", { width: 92, height: 52, rx: 12 }));
            var ft = svgEl("text", { x: 46, y: 31, "text-anchor": "middle" });
            ft.textContent = "EMISORA";
            fu.appendChild(ft);
            capaN.appendChild(fu);
            pulsos.forEach(function (q) {
                q.l = q.p.getTotalLength();
                q.c = svgEl("circle", { r: 4, "class": "pulso" });
                capaN.appendChild(q.c);
            });
            if (anima() && primera) {
                g.from(capaL.querySelectorAll(".base"), { strokeDasharray: 600, strokeDashoffset: 600, duration: 1.6, ease: "power3.inOut", stagger: .08, delay: .5 });
                g.from(capaN.querySelectorAll(".nodo-tv"), { opacity: 0, x: 30, duration: 1, ease: EXPO, stagger: .07, delay: .9 });
                g.from(fu, { scale: .6, opacity: 0, transformOrigin: "50% 50%", duration: 1.1, ease: "back.out(1.8)", delay: .35 });
            }
            arrancar();
        }

        function arrancar() {
            if (tick || !g || reducido) return;
            tick = function () {
                for (var i = 0; i < pulsos.length; i++) {
                    var q = pulsos[i];
                    q.o = (q.o + q.v) % 1;
                    var e = q.o < .5 ? 2 * q.o * q.o : 1 - Math.pow(-2 * q.o + 2, 2) / 2;
                    var pt = q.p.getPointAtLength(e * q.l);
                    q.c.setAttribute("cx", pt.x); q.c.setAttribute("cy", pt.y);
                    q.c.setAttribute("opacity", Math.sin(q.o * Math.PI));
                }
            };
            g.ticker.add(tick);
        }
        return { set: dibujar };
    }

    //--- Cabecera: llave y nav --------------------------------------------------
    function cabecera() {
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
        if (anima()) {
            g.from(".cabecera > *", { y: -24, opacity: 0, duration: .9, ease: EXPO, stagger: .08, clearProps: "all" });
        }
    }

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

    document.addEventListener("DOMContentLoaded", cabecera);

    window.UI = {
        gsap: g, anima: anima, toast: toast, confirmar: confirmar, aviso: aviso, formulario: formulario,
        magnetico: magnetico, contar: contar, entrada: entrada, titular: titular, onda: onda,
        copiar: copiar, hace: hace, esc: esc
    };
})();
