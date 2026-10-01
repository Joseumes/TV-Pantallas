package com.universidad.pantallas

import android.content.Context
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RendererCommon
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceViewRenderer

/**
 * Receptor WebRTC: una PeerConnection por sesión, render del Remote VideoTrack
 * en el SurfaceTextureRenderer a pantalla completa.
 */
class WebRtcReceiver(
    context: Context,
    private val egl: EglBase,
    private val view: SurfaceViewRenderer,
    private val onIce: (String) -> Unit
) {
    private val factory: PeerConnectionFactory = PeerConnectionFactory.builder()
        .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
        .createPeerConnectionFactory()

    private var pc: PeerConnection? = null
    private val ctx: Context = context.applicationContext

    init {
        view.init(egl.eglBaseContext, null)
        // FIT: muestra el contenido completo (con bandas si difiere el aspecto).
        // FILL llenaría todo pero recorta los bordes (pantalla 16:10 → TV 16:9).
        view.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        RegistroLocal.log(ctx, "rtc view init OK")
        // Sin audio de momento: pantallas mudas (evita acoples en salones).
    }

    fun start(sessionId: String, offerSdp: String, llenar: Boolean, answerCb: (String) -> Unit) {
        close()
        // FIT = contenido completo (bandas si difiere el aspecto).
        // FILL = llena todo pero recorta bordes.
        view.setScalingType(
            if (llenar) RendererCommon.ScalingType.SCALE_ASPECT_FILL
            else RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        RegistroLocal.log(ctx, "rtc.start llenar=" + llenar)
        val rtcConfig = PeerConnection.RTCConfiguration(emptyList())
        rtcConfig.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        pc = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                onIce("{\"sdpMid\":\"${c.sdpMid}\",\"sdpMLineIndex\":${c.sdpMLineIndex},\"candidate\":\"${c.sdp}\"}")
            }
            override fun onAddStream(s: MediaStream) {
                s.videoTracks.firstOrNull()?.addSink(view)
            }
            override fun onAddTrack(r: RtpReceiver, s: Array<out MediaStream>) {
                RegistroLocal.log(ctx, "TRACK recibido, videos=" + s.sumOf { it.videoTracks.size })
                s.firstOrNull()?.videoTracks?.firstOrNull()?.addSink(view)
            }
            override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
                RegistroLocal.log(ctx, "pc=" + s.name)
            }
            override fun onSignalingChange(s: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {
                RegistroLocal.log(ctx, "ice=" + s.name)
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(c: Array<IceCandidate>) {}
            override fun onRemoveStream(s: MediaStream) {}
            override fun onDataChannel(d: DataChannel) {}
            override fun onRenegotiationNeeded() {}
        })
        pc?.setRemoteDescription(
            object : SimpleSdp({ RegistroLocal.log(ctx, "remote OK") }) {},
            SessionDescription(SessionDescription.Type.OFFER, offerSdp))
        pc?.createAnswer(object : SimpleSdp() {
            override fun onCreateSuccess(sdp: SessionDescription) {
                RegistroLocal.log(ctx, "answer OK")
                pc?.setLocalDescription(SimpleSdp { }, sdp)
                answerCb(sdp.description)
            }
        }, MediaConstraints())
    }

    fun addIce(json: String) {
        try {
            val o = org.json.JSONObject(json)
            pc?.addIceCandidate(
                IceCandidate(o.getString("sdpMid"), o.getInt("sdpMLineIndex"), o.getString("candidate"))
            )
        } catch (_: Exception) {}
    }

    fun close() {
        try { pc?.close() } catch (_: Exception) {}
        pc = null
        try { view.clearImage() } catch (_: Exception) {}
    }

    fun release() {
        close()
        try { view.release() } catch (_: Exception) {}
    }

    private open class SimpleSdp(val done: () -> Unit = {}) : SdpObserver {
        override fun onCreateSuccess(s: SessionDescription) = done()
        override fun onSetSuccess() = done()
        override fun onCreateFailure(e: String) {}
        override fun onSetFailure(e: String) {}
    }
}
