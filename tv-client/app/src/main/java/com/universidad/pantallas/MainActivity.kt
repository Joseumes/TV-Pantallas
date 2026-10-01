package com.universidad.pantallas

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.webrtc.EglBase
import org.webrtc.SurfaceViewRenderer

/**
 * Pantalla completa: espera → vídeo. Sin controles durante la transmisión
 * (pantalla dedicada).
 */
class MainActivity : AppCompatActivity(), SignalingClient.Listener {

    private lateinit var device: DeviceManager
    private lateinit var signaling: SignalingClient
    private var rtc: WebRtcReceiver? = null
    private lateinit var egl: EglBase

    private lateinit var estado: TextView
    private lateinit var titulo: TextView
    private lateinit var overlay: View
    private lateinit var video: SurfaceViewRenderer
    private lateinit var btnConfig: Button

    private var monitor: NetworkMonitor? = null
    private var sesionActiva: String? = null
    private var ultimoError: String? = null

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        device = DeviceManager.get(this)
        estado = findViewById(R.id.txtEstado)
        titulo = findViewById(R.id.txtTitulo)
        overlay = findViewById(R.id.overlayBox)
        video = findViewById(R.id.videoView)
        btnConfig = findViewById(R.id.btnConfig)

        egl = EglBase.create()
        btnConfig.setOnClickListener {
            startActivity(Intent(this, ConfigActivity::class.java))
        }

        signaling = SignalingClient(device, this)
        monitor = NetworkMonitor(this,
            onLost = { runOnUiThread { mostrarEspera("RED PERDIDA — reintentando…") } },
            onAvailable = { signaling.close(); signaling.connect() })
        monitor?.start()
    }

    override fun onStart() {
        super.onStart()
        entrarInmersivo()
        titulo.text = "TV: ${device.nombre} (${device.deviceId}) v1.1-fit"
        // Si antes se cerró sola, muestra el error guardado (funciona sin USB).
        val fallo = RegistroLocal.leerFallo(this)
        if (fallo != null) {
            val cola = RegistroLocal.ultimas(this).joinToString("\n").takeLast(500)
            mostrarEspera("⚠ SE CERRÓ ANTES:\n" + fallo.take(700) + "\n--- PASOS ---\n" + cola)
        } else {
            mostrarEspera("CONECTANDO a ${device.server}:${device.port}…")
        }
        signaling.connect()
    }

    override fun onStop() {
        super.onStop()
        signaling.close()
        rtc?.close()
    }

    override fun onDestroy() {
        monitor?.stop()
        rtc?.release()
        try { egl.release() } catch (_: Exception) {}
        super.onDestroy()
    }

    private fun entrarInmersivo() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    private fun mostrarEspera(msg: String) {
        video.visibility = View.GONE
        overlay.visibility = View.VISIBLE
        estado.text = msg
    }

    private fun mostrarVideo() {
        overlay.visibility = View.GONE
        video.visibility = View.VISIBLE
        entrarInmersivo()
    }

    //--- SignalingClient.Listener ------------------------------------------------

    override fun onRegistered() {
        runOnUiThread {
            ultimoError = null
            RegistroLocal.borrarFallo(this@MainActivity)
            RegistroLocal.log(this@MainActivity, "registered OK")
            mostrarEspera("✓ SERVIDOR CONECTADO\nEsperando transmisión…")
        }
    }

    override fun onConnectionLost() {
        runOnUiThread { mostrarEspera(ultimoError ?: "RECONECTANDO…") }
    }

    override fun onError(detail: String) {
        runOnUiThread {
            ultimoError = if (detail.contains("token", ignoreCase = true))
                "TOKEN INVÁLIDO — copia el token actual de la web"
            else
                "ERROR: $detail"
            mostrarEspera(ultimoError!!)
        }
    }

    override fun onStreamStart(sessionId: String) {
        // La oferta SDP llega acto seguido por "offer"; aquí solo preparamos.
        RegistroLocal.log(this, "stream_start $sessionId")
        runOnUiThread { mostrarEspera("RECIBIENDO TRANSMISIÓN…") }
    }

    override fun onStreamStop(sessionId: String) {
        RegistroLocal.log(this, "stream_stop $sessionId")
        runOnUiThread {
            sesionActiva = null
            rtc?.close()
            mostrarEspera("✓ SERVIDOR CONECTADO\nEsperando transmisión…")
        }
    }

    override fun onOffer(sessionId: String, sdp: String) {
        RegistroLocal.log(this, "offer recibida bytes=" + sdp.length)
        runOnUiThread {
            sesionActiva = sessionId
            if (rtc == null) {
                rtc = WebRtcReceiver(this, egl, video) { cand ->
                    signaling.sendIce(sessionId, cand)
                }
            }
            mostrarVideo()
            rtc?.start(sessionId, sdp, device.llenar) { answerSdp ->
                signaling.sendAnswer(sessionId, answerSdp)
            }
        }
    }

    override fun onIce(candidate: String) {
        rtc?.addIce(candidate)
    }
}
