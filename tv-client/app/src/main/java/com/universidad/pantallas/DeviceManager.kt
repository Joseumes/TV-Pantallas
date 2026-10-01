package com.universidad.pantallas

import android.content.Context
import android.content.SharedPreferences

/** Config persistente: servidor, deviceId, token. Se edita en ConfigActivity. */
class DeviceManager private constructor(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("pantallas", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", "192.168.10.10") ?: "192.168.10.10"
        set(v) = prefs.edit().putString("server", v).apply()

    var port: Int
        get() = prefs.getInt("port", 8080)
        set(v) = prefs.edit().putInt("port", v).apply()

    var deviceId: String
        get() = prefs.getString("deviceId", "TV-SALON-01") ?: "TV-SALON-01"
        set(v) = prefs.edit().putString("deviceId", v).apply()

    var nombre: String
        get() = prefs.getString("nombre", "Salón 1") ?: "Salón 1"
        set(v) = prefs.edit().putString("nombre", v).apply()

    var token: String
        get() = prefs.getString("token", "") ?: ""
        set(v) = prefs.edit().putString("token", v).apply()

    /** true = llenar pantalla (recorta bordes si el aspecto difiere). */
    var llenar: Boolean
        get() = prefs.getBoolean("llenar", false)
        set(v) = prefs.edit().putBoolean("llenar", v).apply()

    val wsUrl: String get() = "ws://$server:$port/ws/senalizacion"

    companion object {
        @Volatile private var inst: DeviceManager? = null
        fun get(c: Context): DeviceManager =
            inst ?: synchronized(this) { inst ?: DeviceManager(c.applicationContext).also { inst = it } }
    }
}
