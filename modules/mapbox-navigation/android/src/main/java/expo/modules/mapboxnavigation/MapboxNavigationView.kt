package expo.modules.mapboxnavigation

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.net.Uri
import android.graphics.Paint
import android.graphics.Path
import android.os.SystemClock
import android.util.Base64
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import com.mapbox.bindgen.Value
import com.mapbox.geojson.Feature
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraBoundsOptions
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.LayerPosition
import com.mapbox.maps.MapInitOptions
import com.mapbox.maps.MapView
import com.mapbox.maps.RenderedQueryGeometry
import com.mapbox.maps.RenderedQueryOptions
import com.mapbox.maps.ScreenBox
import com.mapbox.maps.ScreenCoordinate
import com.mapbox.maps.extension.style.layers.properties.generated.IconAnchor
import com.mapbox.maps.plugin.LocationPuck3D
import com.mapbox.maps.plugin.ModelScaleMode
import com.mapbox.maps.plugin.animation.CameraAnimationsLifecycleListener
import com.mapbox.maps.plugin.animation.CameraAnimatorType
import com.mapbox.maps.plugin.animation.MapAnimationOptions.Companion.mapAnimationOptions
import com.mapbox.maps.plugin.animation.camera
import com.mapbox.maps.plugin.animation.easeTo
import com.mapbox.maps.plugin.animation.flyTo
import com.mapbox.maps.plugin.annotation.annotations
import com.mapbox.maps.plugin.annotation.generated.OnPointAnnotationClickListener
import com.mapbox.maps.plugin.annotation.generated.PointAnnotation
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationManager
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationOptions
import com.mapbox.maps.plugin.annotation.generated.createPointAnnotationManager
import com.mapbox.maps.plugin.gestures.OnMapClickListener
import com.mapbox.maps.plugin.gestures.OnMapLongClickListener
import com.mapbox.maps.plugin.gestures.gestures
import com.mapbox.maps.plugin.locationcomponent.LocationConsumer
import com.mapbox.maps.plugin.locationcomponent.LocationProvider
import com.mapbox.maps.plugin.locationcomponent.createDefault2DPuck
import com.mapbox.maps.plugin.locationcomponent.location
import com.mapbox.maps.plugin.scalebar.scalebar
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The map. Everything navigation-related (routes, banners, voice, rerouting, arrival) runs in TypeScript;
 * this view only draws: tiles, the vehicle puck (position pushed from JS), the route line, markers and the camera.
 */
@SuppressLint("ViewConstructor", "MissingPermission")
class MapboxNavigationView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  // ---------------------------------------------------------------- events
  private val onReady by EventDispatcher<Map<String, Any>>()
  private val onMapLoaded by EventDispatcher<Map<String, Any>>()
  private val onCameraModeChanged by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  private val onMapPress by EventDispatcher<Map<String, Any>>()
  private val onMapLongPress by EventDispatcher<Map<String, Any>>()
  private val onMarkerPress by EventDispatcher<Map<String, Any>>()

  // ---------------------------------------------------------------- props
  private var explicitStyleUri: String? = null
  private var mapStyle: String = "streets"
  private var theme: String = "system"
  private var vehicle: String = "car"
  private var vehicleScale: Double = 8.0
  private var vehicleRotation: Double = 0.0
  private var showsUserLocation = true
  private var showDestinationPin = true
  private var zoomEnabled = true
  private var scrollEnabled = true
  private var rotateEnabled = true
  private var pitchEnabled = true
  private var destination: Point? = null

  // ---------------------------------------------------------------- state
  private val density = context.resources.displayMetrics.density
  internal val container = FrameLayout(context)

  // The native map lives in a MapBundle: created when this view is attached, or RECEIVED (already loaded) when another
  // view with the same `sharedKey` already has one. Before that, `bundle` is null and the props are only remembered.
  private var bundle: MapBundle? = null
  private var sharedKey: String? = null
  private var adoptScheduled = false
  private var destroyedByReact = false
  private val privateKey = "private:${System.identityHashCode(this)}"
  private val mapView: MapView get() = bundle!!.mapView
  private val locationProvider: ExternalLocationProvider get() = bundle!!.locationProvider
  private var loadedStyleUri: String?
    get() = bundle?.loadedStyleUri
    set(value) {
      bundle?.loadedStyleUri = value
    }
  private var cameraSpec: CameraSpec? = null
  private var pendingImages: Map<String, String> = emptyMap()
  private var currentNight = false
  private var nativeMode = "idle"
  private var cameraControlledByJs = false

  // route line (re-applied after every style load)
  private var routeGeoJson: String? = null
  private var routeGradient: String? = null
  private var alternativesGeoJson: String? = null
  private var routeTrim = 0.0

  // markers
  private val pointAnnotationManager: PointAnnotationManager? get() = bundle?.pinManager // destination pin
  private val markerManager: PointAnnotationManager? get() = bundle?.markerManager // <Marker/>
  private var markerSpecs: List<MarkerSpec> = emptyList()
  private val markerBitmaps: MutableMap<String, Bitmap> get() = bundle!!.markerBitmaps
  private val markerAnnotations: MutableMap<String, PointAnnotation> get() = bundle!!.markerAnnotations
  private val markerSignatures: MutableMap<String, String> get() = bundle!!.markerSignatures
  private val annotationToMarker: MutableMap<String, String> get() = bundle!!.annotationToMarker
  private var lastMarkerPressAt = 0L
  private var lastEmittedMarkerId: String? = null
  private var lastEmittedMarkerAt = 0L
  private var pinBitmap: Bitmap? = null

  init {
    MapboxTokenHelper.applyIfNeeded(context)

    addView(container, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    currentNight = resolveNight()
  }

  /** Let Android lay out the MapView instead of Yoga. */
  override val shouldUseAndroidLayout: Boolean
    get() = true

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    // The map is created (or received, when it is shared) only now: every prop, `sharedKey` included, is already here.
    // Only the FIRST attach takes it: later attaches (a covered screen shown again) never steal a map that moved on.
    // It is taken one message later, NOT inside the attach: moving a view out of another screen while
    // react-native-screens / Fragments are still adding this one is what made Android refuse ("child already has a parent").
    if (bundle == null && !adoptScheduled) {
      adoptScheduled = true
      post { adoptMap() }
    }
  }

  private fun adoptMap() {
    adoptScheduled = false
    if (bundle != null || destroyedByReact || !isAttachedToWindow) return
    val b = SharedMaps.acquire(sharedKey ?: privateKey, context)
    bundle = b
    if (!b.attach(this)) useOwnMap()
  }

  /** The shared map could not be moved here: build a private one instead (never crash). */
  internal fun useOwnMap() {
    val shared = bundle
    if (shared != null && shared.key == privateKey && shared.host === this) return
    shared?.hosts?.remove(this)
    val own = SharedMaps.acquire(privateKey, context)
    bundle = own
    own.attach(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    refreshTheme()
  }

  /** Views with the same key share ONE native map (shared element: nothing is created again). */
  fun setSharedKey(value: String?) {
    sharedKey = value?.takeIf { it.isNotBlank() }
  }

  fun cleanup() {
    destroyedByReact = true
    val b = bundle ?: return
    bundle = null
    b.release(this)
  }

  // ---------------------------------------------------------------- called by the MapBundle
  /** This view just received the map: push every prop of THIS view into it. */
  internal fun onMapAdopted() {
    currentNight = resolveNight()
    decodePendingImages()
    applyStyle()
    applyPuck()
    bundle?.mapView?.location?.enabled = showsUserLocation
    applyGestures()
    updateDestinationPin()
    syncMarkers()
    applyRoute()
    cameraSpec?.let { applyCamera(it) }
    onReady(mapOf("ready" to true))
    if (bundle?.mapLoaded == true) onMapLoadedEvent()
  }

  /** The map finished loading (style + tiles): lets JS swap a placeholder picture for the live map. */
  internal fun onMapLoadedEvent() {
    onMapLoaded(mapOf("loaded" to true))
  }

  internal fun onMapTakenAway() {
    nativeMode = "idle"
  }

  internal fun onCameraAnimationStarted(owner: String?) {
    if (owner != CAMERA_OWNER) emitMode("idle")
  }

  internal fun onMapTapped(point: Point) {
    handleMapClick(point)
  }

  internal fun onMapLongTapped(point: Point) {
    onMapLongPress(mapOf("latitude" to point.latitude(), "longitude" to point.longitude()))
  }

  internal fun onAnnotationClicked(annotationId: String) {
    val markerId = bundle?.annotationToMarker?.get(annotationId) ?: return
    emitMarkerPress(markerId)
  }

  // =============================================================== commands from JS
  /**
   * A picture of the map as it is drawn right now (markers included), saved in the cache. Done by the Maps SDK itself:
   * a GPU surface cannot be photographed with the normal view tools (it comes out black).
   * Resolves with a `file://` uri.
   */
  fun takeSnapshot(promise: Promise) {
    val b = bundle ?: return promise.reject("NO_MAP", "The map is not ready yet", null)
    b.mapView.snapshot { bitmap ->
      if (bitmap == null) {
        promise.reject("SNAPSHOT_FAILED", "The map returned no picture", null)
      } else {
        try {
          // JPEG: a map picture is opaque and a PNG of it is several times bigger, so it loads and decodes much slower
          val file = File(context.cacheDir, "mapbox-nav-snapshot-${System.currentTimeMillis()}.jpg")
          FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out) }
          promise.resolve(Uri.fromFile(file).toString())
        } catch (t: Throwable) {
          promise.reject("SNAPSHOT_FAILED", t.message ?: "Could not save the picture", t)
        }
      }
    }
  }

  fun updateLocation(lat: Double, lng: Double, bearing: Double, durationMs: Double) {
    if (bundle == null) return
    locationProvider.update(
      Point.fromLngLat(lng, lat),
      bearing.takeIf { it >= 0.0 && it.isFinite() },
      durationMs.toLong().coerceAtLeast(0L)
    )
  }

  fun followCamera(lat: Double, lng: Double, bearing: Double, zoom: Double, pitch: Double, durationMs: Double) {
    if (bundle == null) return
    nativeMode = "following"
    val padTop = if (pitch > 0.0) mapView.height * 0.34 else 0.0
    mapView.camera.easeTo(
      CameraOptions.Builder()
        .center(Point.fromLngLat(lng, lat))
        .bearing(bearing)
        .pitch(pitch)
        .zoom(zoom)
        .padding(EdgeInsets(padTop, 0.0, 0.0, 0.0))
        .build(),
      mapAnimationOptions {
        duration(durationMs.toLong().coerceAtLeast(0L))
        owner(CAMERA_OWNER)
      }
    )
  }

  fun fitCamera(points: List<List<Double>>, top: Double, right: Double, bottom: Double, left: Double, durationMs: Double) {
    if (bundle == null || points.size < 2) return
    val coordinates = points.filter { it.size >= 2 }.map { Point.fromLngLat(it[0], it[1]) }
    if (coordinates.size < 2) return
    nativeMode = "overview"
    try {
      val camera = mapView.mapboxMap.cameraForCoordinates(
        coordinates,
        CameraOptions.Builder()
          .padding(EdgeInsets(top * density, left * density, bottom * density, right * density))
          .bearing(0.0)
          .pitch(0.0)
          .build(),
        null,
        null,
        null
      )
      mapView.camera.easeTo(
        camera,
        mapAnimationOptions {
          duration(durationMs.toLong().coerceAtLeast(0L))
          owner(CAMERA_OWNER)
        }
      )
    } catch (t: Throwable) {
      onError(mapOf("code" to "FIT_FAILED", "message" to (t.message ?: "Could not fit the route")))
    }
  }

  // ---------------------------------------------------------------- route line
  fun setRoute(geoJson: String, gradient: String) {
    routeGeoJson = geoJson
    routeGradient = gradient
    routeTrim = 0.0
    applyRoute()
    updateDestinationPin()
  }

  fun setAlternatives(geoJson: String) {
    alternativesGeoJson = geoJson
    applyRoute()
  }

  fun setRouteProgress(fraction: Double) {
    routeTrim = fraction.coerceIn(0.0, 1.0)
    val style = bundle?.mapView?.mapboxMap?.style ?: return
    val value = Value.fromJson("[0.0,$routeTrim]").value ?: return
    if (style.styleLayerExists(ROUTE_LINE)) style.setStyleLayerProperty(ROUTE_LINE, "line-trim-offset", value)
    if (style.styleLayerExists(ROUTE_CASING)) style.setStyleLayerProperty(ROUTE_CASING, "line-trim-offset", value)
  }

  fun clearRoute() {
    routeGeoJson = null
    routeGradient = null
    alternativesGeoJson = null
    routeTrim = 0.0
    updateDestinationPin()
    val style = bundle?.mapView?.mapboxMap?.style ?: return
    removeRouteLayers(style)
  }

  private fun removeRouteLayers(style: com.mapbox.maps.Style) {
    listOf(ROUTE_LINE, ROUTE_CASING, ALT_LINE).forEach { if (style.styleLayerExists(it)) style.removeStyleLayer(it) }
    listOf(ROUTE_SOURCE, ALT_SOURCE).forEach { if (style.styleSourceExists(it)) style.removeStyleSource(it) }
  }

  /** Idempotent: (re)creates sources and layers from the last route data. Called again after a style change. */
  private fun applyRoute() {
    val style = bundle?.mapView?.mapboxMap?.style ?: return
    val geo = routeGeoJson
    if (geo == null) {
      removeRouteLayers(style)
      return
    }

    // main route (lineMetrics is required for line-gradient / line-trim-offset)
    if (style.styleSourceExists(ROUTE_SOURCE)) {
      style.setStyleSourceProperty(ROUTE_SOURCE, "data", Value(geo))
    } else {
      Value.fromJson("""{"type":"geojson","lineMetrics":true,"maxzoom":16,"data":$geo}""").value
        ?.let { style.addStyleSource(ROUTE_SOURCE, it) }
    }

    // alternatives
    val alt = alternativesGeoJson
    if (alt != null) {
      if (style.styleSourceExists(ALT_SOURCE)) {
        style.setStyleSourceProperty(ALT_SOURCE, "data", Value(alt))
      } else {
        Value.fromJson("""{"type":"geojson","data":$alt}""").value?.let { style.addStyleSource(ALT_SOURCE, it) }
      }
    }

    val below = belowLayerId(style)
    val position = LayerPosition(null, below, null)
    val width = """["interpolate",["exponential",1.5],["zoom"],8,3,12,7,16,13,19,24]"""
    val castingWidth = """["interpolate",["exponential",1.5],["zoom"],8,5,12,10,16,19,19,32]"""

    if (!style.styleLayerExists(ALT_LINE) && alt != null) {
      Value.fromJson(
        """{"id":"$ALT_LINE","type":"line","source":"$ALT_SOURCE","layout":{"line-cap":"round","line-join":"round"},
        "paint":{"line-color":"#9AA4B2","line-opacity":0.9,"line-width":$width}}"""
      ).value?.let { style.addStyleLayer(it, position) }
    }
    if (!style.styleLayerExists(ROUTE_CASING)) {
      Value.fromJson(
        """{"id":"$ROUTE_CASING","type":"line","source":"$ROUTE_SOURCE","layout":{"line-cap":"round","line-join":"round"},
        "paint":{"line-color":"#FFFFFF","line-opacity":0.95,"line-width":$castingWidth,"line-trim-offset":[0.0,$routeTrim]}}"""
      ).value?.let { style.addStyleLayer(it, position) }
    }
    if (!style.styleLayerExists(ROUTE_LINE)) {
      Value.fromJson(
        """{"id":"$ROUTE_LINE","type":"line","source":"$ROUTE_SOURCE","layout":{"line-cap":"round","line-join":"round"},
        "paint":{"line-width":$width,"line-trim-offset":[0.0,$routeTrim]}}"""
      ).value?.let { style.addStyleLayer(it, position) }
    }
    routeGradient?.let { g ->
      Value.fromJson(g).value?.let { style.setStyleLayerProperty(ROUTE_LINE, "line-gradient", it) }
    }

    // 3D models (the FS vehicle) are drawn in their own pass, so the lines would be painted over them.
    // Same fix as the official SDK: let 3D objects occlude the route line.
    listOf(ALT_LINE, ROUTE_CASING, ROUTE_LINE).forEach { id ->
      if (style.styleLayerExists(id)) style.setStyleLayerProperty(id, "line-depth-occlusion-factor", Value(1.0))
    }
  }

  /** The route goes under the road labels (and so under the puck, which is on top of everything). */
  private fun belowLayerId(style: com.mapbox.maps.Style): String? =
    listOf("road-label-navigation", "road-label").firstOrNull { style.styleLayerExists(it) }

  // =============================================================== prop setters
  fun setStyleUri(value: String?) {
    explicitStyleUri = value?.takeIf { it.isNotBlank() }
    applyStyle()
  }

  fun setMapStyle(value: String?) {
    mapStyle = value ?: "streets"
    applyStyle()
  }

  fun setTheme(value: String?) {
    theme = value ?: "system"
    refreshTheme()
  }

  fun setVehicle(value: String?) {
    vehicle = value ?: "car"
    applyPuck()
  }

  fun setVehicleScale(value: Double?) {
    vehicleScale = (value ?: 8.0).coerceIn(1.0, 100.0)
    applyPuck()
  }

  fun setVehicleRotation(value: Double?) {
    vehicleRotation = value ?: 0.0
    applyPuck()
  }

  fun setShowsUserLocation(value: Boolean) {
    showsUserLocation = value
    bundle?.mapView?.location?.enabled = value
  }

  fun setShowDestinationPin(value: Boolean) {
    showDestinationPin = value
    updateDestinationPin()
  }

  fun setDestination(value: Point?) {
    destination = value
    updateDestinationPin()
  }

  fun setZoomEnabled(value: Boolean) { zoomEnabled = value; applyGestures() }
  fun setScrollEnabled(value: Boolean) { scrollEnabled = value; applyGestures() }
  fun setRotateEnabled(value: Boolean) { rotateEnabled = value; applyGestures() }
  fun setPitchEnabled(value: Boolean) { pitchEnabled = value; applyGestures() }

  private fun applyGestures() {
    if (bundle == null) return
    mapView.gestures.updateSettings {
      scrollEnabled = this@MapboxNavigationView.scrollEnabled
      rotateEnabled = this@MapboxNavigationView.rotateEnabled
      pitchEnabled = this@MapboxNavigationView.pitchEnabled
      pinchToZoomEnabled = zoomEnabled
      doubleTapToZoomInEnabled = zoomEnabled
      doubleTouchToZoomOutEnabled = zoomEnabled
      quickZoomEnabled = zoomEnabled
    }
  }

  // =============================================================== theme / style
  private fun systemNight(): Boolean =
    (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  private fun resolveNight(): Boolean = when (theme) {
    "dark" -> true
    "light" -> false
    else -> systemNight()
  }

  private fun resolveStyleUri(night: Boolean): String {
    explicitStyleUri?.let { return it }
    return when (mapStyle) {
      "streets" -> if (night) "mapbox://styles/mapbox/dark-v11" else "mapbox://styles/mapbox/streets-v12"
      "outdoors" -> "mapbox://styles/mapbox/outdoors-v12"
      "satellite" -> "mapbox://styles/mapbox/satellite-streets-v12"
      else -> if (night) "mapbox://styles/mapbox/navigation-night-v1" else "mapbox://styles/mapbox/navigation-day-v1"
    }
  }

  private fun applyStyle() {
    if (bundle == null) return
    val uri = resolveStyleUri(currentNight)
    if (uri == loadedStyleUri) return
    loadedStyleUri = uri
    mapView.mapboxMap.loadStyle(uri) { applyRoute() }
  }

  private fun refreshTheme() {
    val night = resolveNight()
    if (night != currentNight) currentNight = night
    applyStyle()
  }

  // =============================================================== vehicle puck (3D FS models)
  private fun applyPuck() {
    if (bundle == null) return
    val scale = vehicleScale.toFloat()
    val rotation = vehicleRotation.toFloat()
    mapView.location.locationPuck = when (vehicle) {
      "car" -> LocationPuck3D(
        modelUri = "asset://models/fs_car.glb",
        modelScale = listOf(scale, scale, scale),
        modelRotation = listOf(0f, 0f, rotation),
        modelScaleMode = ModelScaleMode.MAP,
      )
      "bike" -> LocationPuck3D(
        modelUri = "asset://models/fs_bike.glb",
        modelScale = listOf(scale, scale, scale),
        modelRotation = listOf(0f, 0f, rotation),
        modelScaleMode = ModelScaleMode.MAP,
      )
      else -> createDefault2DPuck(withBearing = true)
    }
  }

  // =============================================================== camera (<Camera/>, like @rnmapbox/maps)
  data class CameraSpec(
    val centerCoordinate: List<Double>?, // [longitude, latitude]
    val zoomLevel: Double?,
    val pitch: Double?,
    val heading: Double?,
    val animationMode: String?, // flyTo | easeTo | linearTo | moveTo | none
    val animationDuration: Double?, // ms
    val minZoomLevel: Double?,
    val maxZoomLevel: Double?,
  )

  fun applyCamera(spec: CameraSpec?) {
    if (spec == null) return
    cameraSpec = spec // re-applied whenever this view receives the (shared) map
    cameraControlledByJs = true
    if (bundle == null) return

    if (spec.minZoomLevel != null || spec.maxZoomLevel != null) {
      val bounds = CameraBoundsOptions.Builder()
      spec.minZoomLevel?.let { bounds.minZoom(it) }
      spec.maxZoomLevel?.let { bounds.maxZoom(it) }
      mapView.mapboxMap.setBounds(bounds.build())
    }

    val builder = CameraOptions.Builder()
    var hasTarget = false
    spec.centerCoordinate?.takeIf { it.size >= 2 }?.let {
      builder.center(Point.fromLngLat(it[0], it[1]))
      hasTarget = true
    }
    spec.zoomLevel?.let { builder.zoom(it); hasTarget = true }
    spec.pitch?.let { builder.pitch(it); hasTarget = true }
    spec.heading?.let { builder.bearing(it); hasTarget = true }
    if (!hasTarget) return

    emitMode("idle")

    val options = builder.build()
    val duration = (spec.animationDuration ?: 1000.0).toLong().coerceAtLeast(0L)
    when (spec.animationMode) {
      "flyTo" -> mapView.camera.flyTo(options, mapAnimationOptions { duration(duration) })
      "easeTo", "linearTo" -> mapView.camera.easeTo(options, mapAnimationOptions { duration(duration) })
      else -> mapView.mapboxMap.setCamera(options)
    }
  }

  private fun emitMode(mode: String) {
    if (nativeMode == mode) return
    nativeMode = mode
    onCameraModeChanged(mapOf("mode" to mode))
  }

  // =============================================================== markers (<Marker/>)
  data class MarkerSpec(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val icon: String,
    val anchorX: Double,
    val anchorY: Double,
  )

  fun setMarkers(value: List<MarkerSpec>?) {
    markerSpecs = value ?: emptyList()
    syncMarkers()
  }

  /** icon key -> base64 PNG (captured from the SVG children in JS, once per key). */
  fun setMarkerImages(value: Map<String, String>?) {
    pendingImages = value ?: emptyMap()
    if (bundle == null) return
    decodePendingImages()
    syncMarkers()
  }

  /** The decoded pictures are shared by every view that uses the same map: a second view never decodes them again. */
  private fun decodePendingImages() {
    val cache = bundle?.markerBitmaps ?: return
    pendingImages.forEach { (key, base64) ->
      if (base64.isBlank() || cache.containsKey(key)) return@forEach
      runCatching {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      }.getOrNull()?.let { cache[key] = it }
    }
  }

  private fun anchorFor(x: Double, y: Double): IconAnchor {
    val h = when { x < 0.33 -> 0; x > 0.66 -> 2; else -> 1 }
    val v = when { y < 0.33 -> 0; y > 0.66 -> 2; else -> 1 }
    return when (v) {
      0 -> when (h) { 0 -> IconAnchor.TOP_LEFT; 2 -> IconAnchor.TOP_RIGHT; else -> IconAnchor.TOP }
      2 -> when (h) { 0 -> IconAnchor.BOTTOM_LEFT; 2 -> IconAnchor.BOTTOM_RIGHT; else -> IconAnchor.BOTTOM }
      else -> when (h) { 0 -> IconAnchor.LEFT; 2 -> IconAnchor.RIGHT; else -> IconAnchor.CENTER }
    }
  }

  private fun signature(spec: MarkerSpec) = "${spec.icon}|${anchorFor(spec.anchorX, spec.anchorY)}"

  /** Diff-based: only creates / moves / removes the markers that actually changed. */
  private fun syncMarkers() {
    val manager = markerManager ?: return
    val wanted = markerSpecs.filter { markerBitmaps.containsKey(it.icon) }.associateBy { it.id }

    val removedIds = markerAnnotations.keys.filter { id ->
      val spec = wanted[id]
      spec == null || markerSignatures[id] != signature(spec)
    }
    if (removedIds.isNotEmpty()) {
      manager.delete(removedIds.mapNotNull { markerAnnotations[it] })
      removedIds.forEach { id ->
        markerAnnotations.remove(id)?.let { annotationToMarker.remove(it.id) }
        markerSignatures.remove(id)
      }
    }

    val moved = mutableListOf<PointAnnotation>()
    wanted.values.forEach { spec ->
      val annotation = markerAnnotations[spec.id] ?: return@forEach
      val current = annotation.point
      if (current.latitude() != spec.latitude || current.longitude() != spec.longitude) {
        annotation.point = Point.fromLngLat(spec.longitude, spec.latitude)
        moved.add(annotation)
      }
    }
    if (moved.isNotEmpty()) manager.update(moved)

    val toCreate = wanted.values.filter { !markerAnnotations.containsKey(it.id) }
    if (toCreate.isNotEmpty()) {
      val options = toCreate.map { spec ->
        PointAnnotationOptions()
          .withPoint(Point.fromLngLat(spec.longitude, spec.latitude))
          .withIconImage(markerBitmaps.getValue(spec.icon))
          .withIconAnchor(anchorFor(spec.anchorX, spec.anchorY))
          .withIconSize(1.0 / density)
      }
      val created = manager.create(options)
      created.forEachIndexed { index, annotation ->
        val spec = toCreate[index]
        markerAnnotations[spec.id] = annotation
        markerSignatures[spec.id] = signature(spec)
        annotationToMarker[annotation.id] = spec.id
      }
    }
  }

  // ---------------------------------------------------------------- marker presses
  private fun emitMarkerPress(id: String) {
    val now = SystemClock.uptimeMillis()
    if (id == lastEmittedMarkerId && now - lastEmittedMarkerAt < 400) return
    lastEmittedMarkerId = id
    lastEmittedMarkerAt = now
    lastMarkerPressAt = now
    onMarkerPress(mapOf("id" to id))
  }

  /** Deterministic hit-test (independent of the annotation plugin): finds the marker under a screen point. */
  private fun findMarkerAt(x: Double, y: Double): String? {
    val slop = 10.0 * density
    var bestId: String? = null
    var bestDistance = Double.MAX_VALUE
    for (spec in markerSpecs) {
      val bitmap = markerBitmaps[spec.icon] ?: continue
      val p = mapView.mapboxMap.pixelForCoordinate(Point.fromLngLat(spec.longitude, spec.latitude))
      val w = bitmap.width.toDouble()
      val h = bitmap.height.toDouble()
      val fx = when { spec.anchorX < 0.33 -> 0.0; spec.anchorX > 0.66 -> 1.0; else -> 0.5 }
      val fy = when { spec.anchorY < 0.33 -> 0.0; spec.anchorY > 0.66 -> 1.0; else -> 0.5 }
      val left = p.x - fx * w
      val top = p.y - fy * h
      if (x >= left - slop && x <= left + w + slop && y >= top - slop && y <= top + h + slop) {
        val d = Math.hypot(x - (left + w / 2), y - (top + h / 2))
        if (d < bestDistance) {
          bestDistance = d
          bestId = spec.id
        }
      }
    }
    return bestId
  }

  // ---------------------------------------------------------------- map taps (places / POIs)
  private fun stringProp(feature: Feature, key: String): String? =
    runCatching { if (feature.hasProperty(key)) feature.getStringProperty(key) else null }
      .getOrNull()
      ?.takeIf { it.isNotBlank() }

  private fun handleMapClick(point: Point) {
    val map = mapView.mapboxMap
    val center = map.pixelForCoordinate(point)
    findMarkerAt(center.x, center.y)?.let { markerId ->
      emitMarkerPress(markerId)
      return
    }
    val r = 24.0 * density
    val geometry = RenderedQueryGeometry(
      ScreenBox(
        ScreenCoordinate(center.x - r, center.y - r),
        ScreenCoordinate(center.x + r, center.y + r)
      )
    )
    map.queryRenderedFeatures(geometry, RenderedQueryOptions(null, null)) { result ->
      if (SystemClock.uptimeMillis() - lastMarkerPressAt < 600) return@queryRenderedFeatures
      val payload = mutableMapOf<String, Any>(
        "latitude" to point.latitude(),
        "longitude" to point.longitude(),
      )
      val hit = result.value
        ?.firstOrNull { it.queriedFeature.sourceLayer in POI_SOURCE_LAYERS }
        ?.queriedFeature
        ?.feature
      if (hit != null) {
        (hit.geometry() as? Point)?.let {
          payload["latitude"] = it.latitude()
          payload["longitude"] = it.longitude()
        }
        stringProp(hit, "name")?.let { payload["name"] = it }
        (stringProp(hit, "category_en") ?: stringProp(hit, "class") ?: stringProp(hit, "type"))
          ?.let { payload["category"] = it }
        payload["isPlace"] = true
      }
      onMapPress(payload)
    }
  }

  // ---------------------------------------------------------------- destination pin
  private fun createPinBitmap(): Bitmap {
    val w = (34.0 * density).toInt()
    val h = (46.0 * density).toInt()
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val radius = w / 2f
    paint.color = 0xFFE5484D.toInt()
    val path = Path().apply {
      moveTo(radius - radius * 0.62f, radius * 1.45f)
      lineTo(radius, h.toFloat())
      lineTo(radius + radius * 0.62f, radius * 1.45f)
      close()
    }
    canvas.drawPath(path, paint)
    canvas.drawCircle(radius, radius, radius, paint)
    paint.color = 0xFFFFFFFF.toInt()
    canvas.drawCircle(radius, radius, radius * 0.4f, paint)
    return bitmap
  }

  private fun updateDestinationPin() {
    val manager = pointAnnotationManager ?: return
    manager.deleteAll()
    val point = destination ?: return
    if (!showDestinationPin || routeGeoJson != null) return
    val icon = pinBitmap ?: createPinBitmap().also { pinBitmap = it }
    manager.create(
      PointAnnotationOptions()
        .withPoint(point)
        .withIconImage(icon)
        .withIconAnchor(IconAnchor.BOTTOM)
    )
  }

  companion object {
    private const val CAMERA_OWNER = "FS_NAV_CAMERA"
    private const val ROUTE_SOURCE = "fs-route-src"
    private const val ALT_SOURCE = "fs-alt-src"
    private const val ROUTE_LINE = "fs-route-line"
    private const val ROUTE_CASING = "fs-route-casing"
    private const val ALT_LINE = "fs-alt-line"
    private val POI_SOURCE_LAYERS = setOf("poi_label", "transit_stop_label", "airport_label", "natural_label")
  }
}
