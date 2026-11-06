package expo.modules.mapboxnavigation

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.caverock.androidsvg.SVG
import java.io.File
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** What JS asks for: one picture, either SVG markup or an image uri, with its size in dp (0 = the picture's own size). */
internal data class IconSpec(
  val key: String,
  val svg: String?,
  val uri: String?,
  val width: Double,
  val height: Double,
)

/**
 * Marker pictures, for the whole app (not per map): every distinct SVG / image is drawn ONCE, natively, at the device
 * density (vector = sharp), on a background thread, and then reused by every marker and every map.
 * Nothing here touches react-native-svg or a screenshot of a React view.
 */
internal object MarkerIcons {
  private const val TAG = "ExpoMapboxNav"
  private val cache = ConcurrentHashMap<String, Bitmap>()
  // main thread only
  private val inFlight = HashMap<String, MutableList<(Bitmap?) -> Unit>>()
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "mapbox-nav-icons").apply { isDaemon = true } }
  private val main = Handler(Looper.getMainLooper())

  fun cached(key: String): Bitmap? = cache[key]

  /** Main thread only. Calls [done] on the main thread, at once when the picture is already cached. */
  fun obtain(context: Context, spec: IconSpec, done: (Bitmap?) -> Unit) {
    cache[spec.key]?.let { return done(it) }
    inFlight[spec.key]?.let { it.add(done); return }
    inFlight[spec.key] = mutableListOf(done)
    val app = context.applicationContext
    worker.execute {
      val bitmap = runCatching { render(app, spec) }
        .onFailure { Log.w(TAG, "marker icon '${spec.key}' failed: ${it.message}") }
        .getOrNull()
      if (bitmap != null) cache[spec.key] = bitmap
      main.post { inFlight.remove(spec.key)?.forEach { it(bitmap) } }
    }
  }

  private fun render(context: Context, spec: IconSpec): Bitmap? {
    val density = context.resources.displayMetrics.density
    return if (spec.svg != null) renderSvg(spec, density) else decodeImage(context, spec, density)
  }

  private fun renderSvg(spec: IconSpec, density: Float): Bitmap? {
    val svg = SVG.getFromString(spec.svg)
    // intrinsic size (dp) from the viewBox, else from width/height
    val viewBox = svg.documentViewBox
    val intrinsicW = viewBox?.width() ?: svg.documentWidth
    val intrinsicH = viewBox?.height() ?: svg.documentHeight
    if (viewBox == null && intrinsicW > 0f && intrinsicH > 0f) svg.setDocumentViewBox(0f, 0f, intrinsicW, intrinsicH)

    var wDp = if (spec.width > 0) spec.width.toFloat() else intrinsicW
    var hDp = if (spec.height > 0) spec.height.toFloat() else intrinsicH
    if (wDp <= 0f && hDp <= 0f) { wDp = 32f; hDp = 32f }
    if (wDp <= 0f) wDp = hDp * (if (intrinsicH > 0f) intrinsicW / intrinsicH else 1f)
    if (hDp <= 0f) hDp = wDp * (if (intrinsicW > 0f) intrinsicH / intrinsicW else 1f)

    val wPx = (wDp * density).toInt().coerceAtLeast(1)
    val hPx = (hDp * density).toInt().coerceAtLeast(1)
    svg.setDocumentWidth(wPx.toFloat())
    svg.setDocumentHeight(hPx.toFloat())
    val bitmap = Bitmap.createBitmap(wPx, hPx, Bitmap.Config.ARGB_8888)
    svg.renderToCanvas(Canvas(bitmap))
    return bitmap
  }

  private fun decodeImage(context: Context, spec: IconSpec, density: Float): Bitmap? {
    val uri = spec.uri ?: return null
    val raw: Bitmap? = when {
      uri.startsWith("http://") || uri.startsWith("https://") ->
        URL(uri).openStream().use { BitmapFactory.decodeStream(it) }
      uri.startsWith("file://") -> BitmapFactory.decodeFile(File(java.net.URI(uri)).path)
      uri.startsWith("/") -> BitmapFactory.decodeFile(uri)
      else -> {
        // release builds: bundled assets are Android drawable resources, referenced by name
        val id = context.resources.getIdentifier(uri, "drawable", context.packageName)
        if (id != 0) BitmapFactory.decodeResource(context.resources, id) else null
      }
    }
    if (raw == null) return null
    val wPx = if (spec.width > 0) (spec.width * density).toInt() else raw.width
    val hPx = if (spec.height > 0) (spec.height * density).toInt() else raw.height
    if (wPx <= 0 || hPx <= 0 || (wPx == raw.width && hPx == raw.height)) return raw
    return Bitmap.createScaledBitmap(raw, wPx, hPx, true).also { if (it !== raw) raw.recycle() }
  }
}
