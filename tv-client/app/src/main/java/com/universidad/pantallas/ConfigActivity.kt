package com.universidad.pantallas

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Switch
import androidx.appcompat.app.AppCompatActivity

/** Primera instalación: servidor, puerto, código y nombre. Guarda en DeviceManager. */
class ConfigActivity : AppCompatActivity() {
    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        setContentView(R.layout.activity_config)
        val d = DeviceManager.get(this)

        val eSrv = findViewById<EditText>(R.id.eServer)
        val ePort = findViewById<EditText>(R.id.ePort)
        val eId = findViewById<EditText>(R.id.eDevice)
        val eNom = findViewById<EditText>(R.id.eNombre)
        val eTok = findViewById<EditText>(R.id.eToken)
        val eLlenar = findViewById<Switch>(R.id.eLlenar)

        eSrv.setText(d.server)
        ePort.setText(d.port.toString())
        eId.setText(d.deviceId)
        eNom.setText(d.nombre)
        eTok.setText(d.token)
        eLlenar.isChecked = d.llenar

        findViewById<Button>(R.id.btnGuardar).setOnClickListener {
            d.server = eSrv.text.toString().trim().ifEmpty { "192.168.10.10" }
            d.port = ePort.text.toString().toIntOrNull() ?: 8080
            d.deviceId = eId.text.toString().trim().uppercase().ifEmpty { "TV-SALON-01" }
            d.nombre = eNom.text.toString().trim().ifEmpty { d.deviceId }
            d.token = eTok.text.toString().trim()
            d.llenar = eLlenar.isChecked
            finish()
        }

        findViewById<Button>(R.id.btnCancelar).setOnClickListener {
            finish()
        }
    }
}
