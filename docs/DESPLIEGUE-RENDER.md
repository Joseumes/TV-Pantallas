# Despliegue gratis en Render — paso a paso

Guía operativa para llevar el servidor local (`servidor/`) a Render (plan
Hobby $0), con el registro de TVs respaldado en Upstash (gratis) y un cron que
mantiene el servicio despierto. Todo gratis, sin tarjeta.

```
TVs (APK, wss://) ──► Render free (Node: REST + WebSocket) ◄── wss:// ── PCs emisores
                          │   el vídeo WebRTC va directo laptop → TV (LAN, igual que antes)
                          └── Upstash Redis (respaldo del registro de TVs)
```

## Paso 0 — Subir los cambios a GitHub

El repo ya está conectado a `https://github.com/Joseumes/TV-Pantallas.git`.

```bat
cd C:\Users\Soporte\Downloads\pruebas\TV-Pantallas
git add -A
git commit -m "Despliegue en Render: PORT/RENDER_EXTERNAL_URL, wss, respaldo Upstash, clave cero-config"
git push origin main
```

Verifica en github.com/Joseumes/TV-Pantallas que aparezcan los últimos commits.

## Paso 1 — Crear la cuenta y el servicio en Render

1. Entra a [render.com](https://render.com) y crea la cuenta (con Google).
   **No pide tarjeta.** El plan gratuito se llama *Hobby* y viene activo.
2. Autoriza a Render a leer tus repos de GitHub.
3. Dashboard → botón **New +** → **Web Service**.
4. Elige el repositorio **TV-Pantallas** → **Connect**.
5. Rellena así (lo que no se mencione, déjalo como sugiere Render):
   - **Name:** `pantallas-umes` (de aquí saldrá tu URL:
     `https://pantallas-umes.onrender.com`)
   - **Language:** Node
   - **Root Directory:** `servidor`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** *Free*
6. Antes de crear, abre la sección **Advanced → Add Environment Variable** y
   agrega:

   | Variable | Valor |
   |---|---|
   | `API_KEY` | clave larga aleatoria de ~64 caracteres (genérala abriendo PowerShell: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 \| ForEach-Object {[char]$_})`) |
   | `NODE_VERSION` | `22` |

7. **Create Web Service**. Espera el deploy (1–2 min, se ve en los logs).
8. Abre `https://pantallas-umes.onrender.com/api/salud` → debe responder
   `{"estado":"ok",...}` sin pedir clave. Con eso el servicio ya vive.

## Paso 2 — Crear Upstash (respaldo del registro de TVs)

**Por qué:** en Render free no hay disco persistente; cada reinicio borra
`pantallas.json` y perderías los tokens de las TVs. Upstash es un Redis en la
nube con tier permanente gratis que este server usa como respaldo.

1. Entra a [upstash.com](https://upstash.com) y crea la cuenta (con Google).
2. Console → **Create Database**.
3. Configura: **Name** `pantallas`, **Type** Regional, proveedor/region lo más
   cercano (ej. `us-east-1`). Plan **Free**. → Create.
4. Dentro de la base, pestaña **REST API** (a veces aparece como "REST API
   Tokens"). Copia los DOS valores:
   - `UPSTASH_REDIS_REST_URL` (algo como `https://pantallas-12345.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (token largo)

   ⚠️ No uses el token de "Redis connection" del paso "Connect to your
   database": es otro. El que este server necesita es el de **REST API**.
5. Vuelve al [dashboard de Render](https://dashboard.render.com) → servicio
   **pantallas-umes** → **Environment** → agrega:

   | Variable | Valor |
   |---|---|
   | `UPSTASH_REDIS_REST_URL` | la URL del paso 4 |
   | `UPSTASH_REDIS_REST_TOKEN` | el token del paso 4 |

6. **Save Changes** → Render hace redeploy solo (~1 min).

Desde ahora: al arrancar, el servicio *restaura* el registro de TVs desde
Upstash; y cada vez que cambie el registro (alta/edición/baja de TVs) lo
*respalda*. Si el servicio se reinicia, las TVs conservan su token sin
necesidad de reconfigurar nada.

## Paso 3 — Cron para que el servicio nunca duerma (gratis)

Las instancias free se apagan tras 15 min sin tráfico (y tardan ~1 min en
despertar). Las conexiones de las TVs ya cuentan como actividad, pero para
que el panel responda siempre al instante, un ping externo lo mantiene vivo.

1. Entra a [cron-job.org](https://cron-job.org) (alternativa: UptimeRobot) y
   crea la cuenta (con Google).
2. **Cronjobs → CREATE CRONJOB**.
3. Configura:
   - **Title:** `Ping pantallas`
   - **URL:** `https://pantallas-umes.onrender.com/api/salud`
   - **Method:** GET
   - **Save execution log** ✅ (útil para ver que sí pega)
4. Create. En la lista debe figurar con "next run" a menos de 5 min.

Con esto el servicio queda encendido 24/7. Las 750 h de instancia free del
mes sobran: un solo servicio siempre encendido gasta ~720 h.

## Paso 4 — Verificar que todo quedó bien

Desde cualquier PC con Internet:

1. `https://pantallas-umes.onrender.com/` → el panel abre y arriba dice
   "Sistema conectado". Nada de claves: entras sin hacer nada.
2. `https://pantallas-umes.onrender.com/emisora.html` → chips de labo-
   ratorios con "Compartir pantalla".
3. Agrega una TV de prueba: panel → ficha del laboratorio → "Agregar TV" con
   código `PRUEBA-01` (bórrala después).
4. Haz clic en su ficha (Datos técnicos): el campo **Servidor** debe decir
   `wss://pantallas-umes.onrender.com/ws/senalizacion` — esa es la línea que
   se escribe en la APK.

## Paso 5 — Recompilar la APK e instalarla en las TVs

La APK nueva acepta URL completas (`wss://...`) además de la IP clásica.

1. Abre `tv-client/` en Android Studio → **Build → Build Bundle(s)/APK(s) →
   Build APK(s)** → `tv-client/app/build/outputs/apk/release/app-release.apk`.
2. Reinstala en cada TV (TV con WiFi y ADB habilitado):

   ```bat
   herramientas\instalar-tvs.bat app-release.apk
   ```

3. En cada TV: abre la app → **Configurar** → escribe la ficha que viste en el
   panel (Servidor `wss://...`, Código, Token; puerto déjalo como está).
4. La TV debe pasar a 🟢 ONLINE ("Lista") en el panel en segundos.
5. Cuando estés estable, apaga **ADB Debugging** en las TVs.

Nota: el campo "Servidor" acepta también una IP para el modo local, así que la
misma APK funciona en la LAN si algún día vuelves al servidor propio.

## Paso 6 — Emitir

En cualquier PC del campus con Chrome/Edge:

1. Abre `https://pantallas-umes.onrender.com/emisora.html` → laboratorio →
   "Compartir pantalla" → elige la pantalla → Confirmar. La TV muestra lo de
   tu laptop en segundos.
2. Corte: vuelve a la emisora y detén la sesión (o Desde el panel, "Detener
   sesión"). Los demás laboratorios siguen transmitiendo.

Ya no hace falta nada de certificados ni instalar raíces de confianza: Render
entrega HTTPS real y el navegador permite capturar pantalla sin trucos.

---

## Resumen de límites del gratis y nuestra situación

| Límite | Valor | Nosotros |
|---|---|---|
| Instancia horas | 750 h/mes | 1 servicio 24/7 ≈ 720 h ✅ |
| RAM / vCPU | 512 MB / 0.1 | el server es minúsculo ✅ |
| Ancho de banda | 5 GB/mes | solo señalización (KBs) ✅ |
| Spin-down | 15 min sin tráfico | mitigado con el cron ✅ |
| Disco | efímero | mitigado con Upstash ✅ |
| WebSockets | soportados; cuentan como actividad | ✅ |
| Upstash free | 256 MB / ~10k comandos-día* | usamos < 20/día ✅ |
| Build minutes | 500/mes | ~1 min/deploy ✅ |

Render no cobra si no dejas tarjeta: el peor caso es que suspenda el servicio
hasta el mes siguiente si te pasas de horas.

## Si algún día quieres pagar (opcional)

**Starter $7/mes** en el Web Service: sin spin-down, con disco persistente
(podrías retirar Upstash) y SSH. Es la única forma de "permanente" sin crons
ni respaldo; con lo implementado no es necesario.

## Volver al modo local (rollback)

Nada se perdió: el mismo código con el mismo `config.json` (`puerto`,
`apiKey`, bloque `https`) funciona en la LAN como siempre; sin URL externa la
ficha de las TVs vuelve a mostrar `IP:PUERTO` automáticamente.

## Solución de problemas

- **TV no pasa a ONLINE** → mira **Logs** en Render; debe salir `registered`.
  Verifica que Servidor empiece por `wss://` y que el token de la ficha sea el
  vigente (si alguien lo regeneró, escribe la ficha nueva en la TV).
- **"token inválido" en los logs** → el respaldo estaba vacío y la TV trae un
  token que el server no conoce: borra la TV en el panel, créala de nuevo y
  escribe su ficha nueva en la TV (~1 min).
- **Panel tarda ~1 min en responder** → el servicio se despertó; el cron del
  Paso 3 evita esto (verifica que esté activo y con su última ejecución OK).
- **Error 401 en el panel** → F5 para re-sincronizar la clave; si persiste,
  revisa que `API_KEY` esté definida en Render (el server no arranca sin ella:
  se ve como crash en los Logs).
- **Upstash dice "Unauthorized"/"IAM"** → copiaste el token equivocado: usa el
  de la pestaña **REST API**, no el de "Redis connection".
- **Se despliega algo y no se ve** → cada push a GitHub provoca redeploy
  automático; espera ~1 min y recarga con Ctrl+F5.
