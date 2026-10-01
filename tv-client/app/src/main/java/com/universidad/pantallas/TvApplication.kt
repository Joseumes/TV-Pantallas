package com.universidad.pantallas

import android.app.Application
import org.webrtc.PeerConnectionFactory

class TvApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Guarda cualquier excepción no capturada para leerla sin USB.
        val previo = Thread.getDefaultUncaughtExceptionHandler()
        val app = this
        Thread.setDefaultUncaughtExceptionHandler { hilo, t ->
            RegistroLocal.guardarFallo(app, t)
            previo?.uncaughtException(hilo, t)
        }
        // PeerConnectionFactory global (video H.264 por hardware cuando exista).
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(this)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
    }
}
