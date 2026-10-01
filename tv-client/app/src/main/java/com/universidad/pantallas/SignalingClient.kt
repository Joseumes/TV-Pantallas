package com.universidad.pantallas

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * WebSocket de señalización. NO transporta vídeo, solo JSON:
 * register/registered, ping/pong, stream_start/stop, offer, answer, ice.
 * Reconexión automática con backoff.
 */
class SignalingClient(
    private val device: DeviceManager,
    private val listener: Listener
) {
    interface Listener {
        fun onRegistered()
        fun onConnectionLost()
        fun onStreamStart(sessionId: String)
        fun onStreamStop(sessionId: String)
        fun onOffer(sessionId: String, sdp: String)
        fun onIce(candidate: String)
        fun onError(detail: String)
    }

    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private var ws: WebSocket? = null
    private var cerrado = false
    private var reintentoMs = 1000L
    private var pingThread: Thread? = null

    fun connect() {
        cerrado = false
        val req = Request.Builder().url(device.wsUrl).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(w: WebSocket, r: Response) {
                reintentoMs = 1000L
                sendRegister()
                startPing()
            }
            override fun onMessage(w: WebSocket, text: String) = manejar(text)
            override fun onFailure(w: WebSocket, t: Throwable, r: Response?) = reprogramar()
            override fun onClosed(w: WebSocket, code: Int, reason: String) = reprogramar()
        })
    }

    fun close() {
        cerrado = true
        pingThread?.interrupt()
        try { ws?.close(1000, "fin") } catch (_: Exception) {}
    }

    private fun reprogramar() {
        listener.onConnectionLost()
        if (cerrado) return
        Thread {
            try { Thread.sleep(reintentoMs) } catch (_: InterruptedException) { return@Thread }
            reintentoMs = (reintentoMs * 2).coerceAtMost(15000L)
            if (!cerrado) connect()
        }.start()
    }

    private fun sendRegister() {
        val o = JSONObject()
        o.put("type", "register")
        o.put("deviceId", device.deviceId)
        o.put("name", device.nombre)
        o.put("ip", "")
        o.put("version", "1.0.0")
        o.put("token", device.token)
        ws?.send(o.toString())
    }

    private fun startPing() {
        pingThread?.interrupt()
        pingThread = Thread {
            while (!cerrado) {
                try {
                    Thread.sleep(5000)
                    val o = JSONObject()
                    o.put("type", "ping")
                    o.put("deviceId", device.deviceId)
                    ws?.send(o.toString())
                } catch (_: InterruptedException) { return@Thread }
            }
        }.also { it.start() }
    }

    private fun manejar(text: String) {
        val o = try { JSONObject(text) } catch (_: Exception) { return }
        when (o.optString("type")) {
            "registered" -> {
                val tok = o.optString("token", "")
                if (tok.isNotEmpty()) device.token = tok
                listener.onRegistered()
            }
            "stream_start" -> listener.onStreamStart(o.optString("sessionId"))
            "stream_stop" -> listener.onStreamStop(o.optString("sessionId"))
            "offer" -> listener.onOffer(o.optString("sessionId"), o.optString("sdp"))
            "ice" -> listener.onIce(o.optString("candidate"))
            "error" -> listener.onError(o.optString("detail", "error"))
        }
    }

    fun sendAnswer(sessionId: String, sdp: String) {
        val o = JSONObject()
        o.put("type", "answer")
        o.put("sessionId", sessionId)
        o.put("sdp", sdp)
        ws?.send(o.toString())
    }

    fun sendIce(sessionId: String, candidate: String) {
        val o = JSONObject()
        o.put("type", "ice")
        o.put("sessionId", sessionId)
        o.put("candidate", candidate)
        ws?.send(o.toString())
    }
}
