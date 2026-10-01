# Pantallas institucionales (proyecto separado)

Sistema de transmisión de pantalla de laptop a 4 TVs Hisense Fire TV por WebRTC.
El servidor solo señaliza y controla; el vídeo va directo laptop → TV.

```
pantallas-tv/
  servidor/      Node.js: REST + WebSocket señalización + sirve la web (puerto 8080)
  web/           Panel operador (pantallas.html) + emisora laptop (emisora.html)
  tv-client/     APK nativa Kotlin para Fire TV (com.universidad.pantallas)
  herramientas/  instalar-tvs.bat (ADB)
```

## 1. Servidor

```bat
cd servidor
npm install
REM edita config.json y pon una apiKey larga
npm start
```

- Panel: `http://192.168.10.10:8080/` · Emisora: `http://192.168.10.10:8080/emisora.html`
- Salud (sin clave): `http://192.168.10.10:8080/api/salud`
- REST con `X-Api-Key`: `GET /api/pantallas`, `POST /api/pantallas` (agregar TV),
  `DELETE /api/pantallas/:id`, `POST /api/sesiones`, `DELETE /api/sesiones/:id`
- WS: `ws://192.168.10.10:8080/ws/senalizacion` (la TV se autentica con token, no con API Key)
- Estado en `servidor/pantallas.json`. Ping cada 5 s, offline a los 20 s.

## 2. Agregar las TVs por laboratorio (desde la web)

La API Key ya viene integrada en la web: en cualquier máquina abre el panel y
funciona sin pegar nada (red local cerrada).

1. Abre `http://192.168.10.10:8080/` (o la URL del túnel).
2. En "Agregar TV Hisense": código `LAB1-01`, nombre `Lab 1 TV 1`, lab `lab1` → Agregar TV.
   Repite por laboratorio (`lab1`, `lab2`, `lab3`, `lab4`).
3. Entra a la pestaña del lab: verás solo sus TVs, cada tarjeta con su ficha
   (Servidor, Puerto, Código, Token) y botones Editar/Eliminar.
4. En cada TV abre la app → Configurar y escribe su ficha **una sola vez** → Guardar.
   La tarjeta pasa a 🟢 ONLINE. El nombre y el lab se gestionan desde la web;
   la TV los conserva aunque se reinicie o se caiga la red (token guardado en
   la TV + `pantallas.json` en el servidor). No hay que reconfigurar.

## 3. Instalar la APK en cada TV (Hisense 55QD7QF, Fire OS)

1. TV: Settings → My Fire TV → Developer Options → ADB Debugging ON, Apps from Unknown Sources ON.
   (Si no aparece: About → Your TV → pulsar 7 veces.)
2. Reservas DHCP en el router: .101–.104.
3. Abrir `tv-client/` en Android Studio → Build → APK, luego:
   `herramientas\instalar-tvs.bat app-release.apk`
4. En cada TV abre la app → Configurar y escribe su ficha (servidor, puerto, código, token) → Guardar.
   La tarjeta en la web pasa a 🟢 ONLINE.
5. En producción: ADB Debugging OFF.

## 4. Transmitir por laboratorio (varios a la vez)

Cada laboratorio es independiente: entra a su tarjeta → selecciona sus TVs →
"Transmitir a seleccionadas". En la emisora elige el lab en los chips y Transmitir.

Varios laboratorios pueden transmitir **al mismo tiempo**, cada uno desde su PC:
las sesiones son independientes y únicas por salón (cortar una no afecta a las
otras; una TV nunca queda en dos sesiones). La emisora marca como ocupadas las
TVs en sesión y no se las quita a otro lab. Si una sesión queda zombi (se creó
pero nadie transmite), el servidor la expira solo a los 3 minutos, o usa
**Liberar lab** en la emisora / **Detener sesión** en el panel.

## 4. MVP

1 laptop → servidor → 1 Hisense, 1080p30, 30 min estables. Luego clonar a las otras 3.

## 5. Emitir desde cualquier PC de la red

El navegador solo deja compartir pantalla en contexto seguro. El servidor ya
sirve HTTPS en el puerto 8443 cuando existen los certificados:

1. En el PC servidor: `herramientas\generar-cert.bat 172.17.0.100`
   (cambia la IP si la del servidor es otra; requiere openssl).
2. Reinicia el servidor: verás la línea `Pantallas HTTPS`.
3. Abre el puerto: `netsh advfirewall firewall add rule name="Pantallas 8443" dir=in action=allow protocol=TCP localport=8443`
4. En CADA pc emisor: copia `servidor/cert-cert.pem` y como admin:
   `certutil -addstore root cert-cert.pem` (una sola vez; es red interna).
5. En ese PC abre `https://172.17.0.100:8443/emisora.html`, pega la API Key
   (la misma del servidor, queda guardada en ese navegador) y Capturar → Transmitir.

El vídeo sigue yendo directo PC → TVs; el servidor solo coordina.

## 6. Límites

- 4× 5 Mbps ≈ 20 Mbps de subida desde la laptop: usar Ethernet.
- Sincronía entre TVs ~200–500 ms (presentaciones sí, videowall no).
- Sin audio (pantallas mudas a propósito).
