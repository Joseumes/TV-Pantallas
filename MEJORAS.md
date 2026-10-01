# Escaneo funcional y mejoras propuestas

Revisión de `servidor/server.js`, `web/*.js`, `web/tv-sim.html` y la APK (`tv-client/`).
No se aplicó ninguno de estos cambios: el rediseño solo tocó la capa visual.

## 🔴 Seguridad (prioridad alta)

1. **La API Key es pública.** `/config-web.js` entrega la clave a cualquiera que abra la web en la red, sin autenticación. En la práctica cualquiera puede crear, borrar o transmitir. Lo mejor: un login de operador (usuario y contraseña con sesión o cookie) y dejar de incrustar la clave.
2. **El WebSocket no tiene autenticación para emisoras.** Cualquier cliente puede mandar `hello_emisora` y recibir todos los `answer` e `ice` de las TVs, o enviar `stream_stop` / `offer` a cualquier sesión o TV. Hay que exigir la API Key (o la sesión) en `hello_emisora` y comprobar que el emisor sea dueño de la sesión.
3. **Una TV puede suplantar a otra.** Los mensajes `offer`, `answer` e `ice` con `toDevice` se reenvían sin comprobar quién los manda. Una TV registrada podría mandarle una `offer` a otra TV. Solo la emisora de la sesión debería poder enviar con `toDevice`.
4. **`ping` confía en `m.deviceId`.** Un socket puede mantener "en línea" a cualquier TV. Debe usar el `deviceId` ligado al socket.
5. **Autorregistro abierto.** Si llega un `register` con un código que no existe, el servidor crea la TV y le devuelve un token. Cualquiera puede meter TVs falsas. Conviene que solo se acepten códigos dados de alta desde el panel.
6. La API Key se compara con `!==` (conviene `crypto.timingSafeEqual`) y no hay límite de intentos.
7. No hay límite de tamaño en el cuerpo de las peticiones (`leerCuerpo`) ni cabeceras de seguridad (CSP, X-Frame-Options).

## 🟠 Bugs encontrados

8. **Falso `tv_offline` al reconectar.** Si una TV reconecta antes de que se cierre su socket viejo, el `close` del viejo avisa `tv_offline` aunque la TV siga conectada. La emisora la quita de su lista hasta recargar. Solo se debe avisar si `socketsTv.get(id) === ws`.
9. **Mayúsculas inconsistentes.** El alta desde la web pasa el código a MAYÚSCULAS, pero `register` (y `POST /api/sesiones`) usan el código tal cual. La APK lo convierte a mayúsculas; la TV simulada no. Si alguien escribe `lab1-01` en otro cliente, aparece una TV duplicada.
10. **Si el emisor pulsa "Dejar de compartir" en el navegador,** la sesión sigue viva y las TVs se quedan en negro. Falta `stream.getVideoTracks()[0].onended → cortar`.
11. **Una TV que se conecta a mitad de una transmisión no entra.** La emisora solo llama a las TVs que había al pulsar Transmitir, y no hay renegociación.
12. **Una TV que se cae a mitad de sesión** queda con `enTransmision = true` y la sesión no la vuelve a llamar al reconectar.
13. **Cerrar la pestaña de la emisora** deja la sesión zombi 3 minutos con las TVs ocupadas. El servidor sabe cuándo se cierra el WS de la emisora: podría terminar sus sesiones en ese momento.
14. **"Detener sesión" en el panel solo detiene la última sesión del lab** si hubiera varias (la emisora sí las libera todas).
15. La emisora reconecta el WS, pero no limpia `tvsOnline`, así que la lista puede mostrar TVs viejas.
16. El servidor no hace ping a nivel de WebSocket (`ws.ping`), así que los sockets muertos se quedan en `socketsTv` hasta que el sistema operativo los cierra.
17. README: hay dos secciones numeradas "## 4".

## 🟡 Funcionalidad que vale la pena agregar

**Operación diaria**
- **Transmitir desde el panel en un solo paso.** Hoy son dos (panel crea la sesión y emisora transmite), y eso confunde. La emisora ya crea sesión sola; el botón del panel podría abrir la emisora con el lab ya elegido.
- **Push en tiempo real al panel** por WebSocket en lugar de consultar cada 10 s. Los cambios de estado aparecerían al instante.
- **Vista previa por TV:** que cada TV mande cada pocos segundos una captura chica de lo que muestra, o al menos sus estadísticas WebRTC (fps, bitrate, pérdida de paquetes).
- **Indicadores de calidad en la emisora:** `getStats()` por cada conexión, con aviso si una TV va lenta.
- **Control de calidad:** elegir 720p o 1080p y el bitrate máximo (`RTCRtpSender.setParameters`). Hoy no hay límite, y con 4 TVs se saturan los ~20 Mbps de subida.
- **Mensaje o cartel en pantalla:** enviar un texto o una imagen fija (aviso, "Volvemos en 5 min") sin compartir la pantalla.
- **Programación:** cartelera por horario (mostrar una URL o imagen en el lab 2 de 8:00 a 10:00).
- **Historial / registro de actividad:** quién transmitió, a qué TVs y cuánto tiempo.

**Gestión de TVs**
- **Configuración por QR:** la ficha (servidor, puerto, código, token) como código QR que la APK escanee. Así no hay que escribir un token de 32 caracteres con el control remoto.
- **Regenerar token desde la web.** El endpoint `POST /api/pantallas/:id/token` ya existe, pero ningún botón lo usa.
- **Comandos remotos a la TV:** reiniciar la app, alternar FIT/FILL, ver su log (`RegistroLocal`) desde el panel.
- **Arranque automático de la APK** al encender la TV (BOOT_COMPLETED) y modo kiosco.
- **Wake-on-LAN / HDMI-CEC** para encender las TVs desde el panel.
- Renombrar o fusionar laboratorios de una vez (hoy se cambia TV por TV).

**Plataforma**
- **Roles:** administrador (alta y baja de TVs) y profesor (solo transmitir en su lab).
- **Audio opcional** por sesión (hoy está deshabilitado a propósito).
- **HTTPS más simple:** generar el certificado desde el propio servidor al primer arranque y ofrecerlo para descargar desde el panel.
- **Persistir sesiones** para que un reinicio del servidor no deje a las TVs a medias.
- **Pruebas automáticas** del flujo de señalización (registro → sesión → offer/answer → stop) con la TV simulada.
- **Servir los estáticos con caché** (ETag) y compresión.

## Qué cambió en el diseño (referencia)

- `web/estilos.css`: identidad de la Universidad Mesoamericana (verde `#0A4735`, crema `#E6DECA`, blanco; tipografía Jost, alternativa libre a Futura; encabezados en cápsula como en umes.edu.gt).
- Pensado para catedráticos: lenguaje simple ("Lista", "Transmitiendo", "Apagada"), guía de 3 pasos en el inicio, pasos numerados en el laboratorio y en Transmitir, botón flotante "¿Cómo transmito?" y la parte técnica (alta de TVs, tokens) plegada bajo "Administración".
- `web/ui.js`: encendido tipo TV con la marca UMES, transiciones de canal, toasts, modales (reemplazan `alert`, `confirm` y `prompt`), odómetros, cintillos, diagrama de señal, ayuda flotante y pie institucional.
- `web/vendor/`: GSAP 3.13 (con SplitText y ScrollTrigger), Lenis y la fuente Jost, servidos en local para que todo funcione sin internet.
- `pantallas.html/js`, `emisora.html/js`, `tv-sim.html`: vistas rehechas. Mismos IDs, mismos endpoints y misma lógica.
- `servidor/server.js`: solo se agregaron los tipos MIME `.woff2` y `.svg` para servir las fuentes.
- Rendimiento: solo se animan `transform`/`opacity`; sin `backdrop-filter` ni capas de mezcla a pantalla completa; animaciones continuas pausadas fuera de pantalla; una sola fuente (26 KB). Medido en un recorrido completo de la página: 60 fps sostenidos y ninguna tarea larga.
