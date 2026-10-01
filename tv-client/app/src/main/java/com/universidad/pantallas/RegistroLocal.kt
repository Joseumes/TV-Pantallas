package com.universidad.pantallas

import android.content.Context
import java.io.File

/**
 * Registro en archivos internos (sin necesidad de USB/adb):
 * - pantallas.log: últimos pasos (hasta dónde llegó antes de morir).
 * - crash.txt: stack trace si fue una excepción Java.
 * Si el proceso lo mata el sistema (memoria) no hay crash.txt, pero el
 * log muestra en qué paso se quedó. Todo se lee en la pantalla de espera.
 */
object RegistroLocal {
    private const val LOG = "pantallas.log"
    private const val CRASH = "crash.txt"
    private const val MAX = 64 * 1024

    @Synchronized
    fun log(c: Context, msg: String) {
        try {
            val f = File(c.filesDir, LOG)
            if (f.exists() && f.length() > MAX) f.delete()
            f.appendText("${System.currentTimeMillis()} $msg\n")
        } catch (_: Exception) {}
    }

    @Synchronized
    fun guardarFallo(c: Context, t: Throwable) {
        try {
            File(c.filesDir, CRASH).writeText(t.stackTraceToString().take(3000))
        } catch (_: Exception) {}
    }

    @Synchronized
    fun leerFallo(c: Context): String? {
        return try {
            val f = File(c.filesDir, CRASH)
            if (f.exists()) f.readText() else null
        } catch (_: Exception) { null }
    }

    @Synchronized
    fun borrarFallo(c: Context) {
        try { File(c.filesDir, CRASH).delete() } catch (_: Exception) {}
    }

    @Synchronized
    fun ultimas(c: Context, n: Int = 10): List<String> {
        return try {
            val f = File(c.filesDir, LOG)
            if (!f.exists()) emptyList() else f.readLines().takeLast(n)
        } catch (_: Exception) { emptyList() }
    }
}
