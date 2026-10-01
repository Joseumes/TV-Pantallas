package com.universidad.pantallas

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

/** Observa la red y avisa para reconectar el WebSocket. */
class NetworkMonitor(context: Context, private val onLost: () -> Unit, private val onAvailable: () -> Unit) {
    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onLost(network: Network) { onLost() }
        override fun onAvailable(network: Network) { onAvailable() }
    }

    fun start() {
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(req, cb)
    }

    fun stop() {
        try { cm.unregisterNetworkCallback(cb) } catch (_: Exception) {}
    }
}
