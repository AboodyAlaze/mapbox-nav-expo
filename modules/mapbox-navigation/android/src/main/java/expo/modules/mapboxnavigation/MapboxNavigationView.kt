@file:OptIn(ExperimentalPreviewMapboxNavigationAPI::class)

package expo.modules.mapboxnavigation

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.Base64
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.mapbox.api.directions.v5.DirectionsCriteria
import com.mapbox.api.directions.v5.models.RouteOptions
import com.mapbox.bindgen.Expected
import com.mapbox.common.location.Location
import com.mapbox.geojson.Feature
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraBoundsOptions
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.MapView
import com.mapbox.maps.RenderedQueryGeometry
import com.mapbox.maps.RenderedQueryOptions
import com.mapbox.maps.ScreenBox
import com.mapbox.maps.ScreenCoordinate
import com.mapbox.maps.plugin.LocationPuck2D
import com.mapbox.maps.plugin.LocationPuck3D
import com.mapbox.maps.plugin.ModelScaleMode
import com.mapbox.maps.plugin.animation.MapAnimationOptions.Companion.mapAnimationOptions
import com.mapbox.maps.plugin.animation.easeTo
import com.mapbox.maps.plugin.animation.flyTo
import com.mapbox.maps.ImageHolder
import com.mapbox.maps.plugin.animation.camera
import com.mapbox.maps.plugin.annotation.annotations
import com.mapbox.maps.plugin.annotation.generated.OnPointAnnotationClickListener
import com.mapbox.maps.plugin.annotation.generated.PointAnnotation
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationManager
import com.mapbox.maps.plugin.locationcomponent.LocationComponentConstants
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationOptions
import com.mapbox.maps.plugin.annotation.generated.createPointAnnotationManager
import com.mapbox.maps.extension.style.layers.properties.generated.IconAnchor
import com.mapbox.maps.plugin.gestures.OnMapClickListener
import com.mapbox.maps.plugin.gestures.OnMapLongClickListener
import com.mapbox.maps.plugin.gestures.gestures
import com.mapbox.maps.plugin.scalebar.scalebar
import com.mapbox.maps.plugin.locationcomponent.location
import com.mapbox.navigation.base.ExperimentalPreviewMapboxNavigationAPI
import com.mapbox.navigation.base.extensions.applyDefaultNavigationOptions
import com.mapbox.navigation.base.extensions.applyLanguageAndVoiceUnitOptions
import com.mapbox.navigation.base.formatter.DistanceFormatterOptions
import com.mapbox.navigation.base.speed.model.SpeedUnit
import com.mapbox.navigation.base.formatter.UnitType
import com.mapbox.navigation.core.formatter.MapboxDistanceFormatter
import com.mapbox.navigation.tripdata.maneuver.api.MapboxManeuverApi
import com.mapbox.navigation.tripdata.speedlimit.api.MapboxSpeedInfoApi
import com.mapbox.navigation.tripdata.speedlimit.model.SpeedInfoValue
import com.mapbox.navigation.ui.components.maneuver.view.MapboxManeuverView
import com.mapbox.navigation.ui.components.speedlimit.model.MapboxSpeedInfoOptions
import com.mapbox.navigation.ui.components.speedlimit.view.MapboxSpeedInfoView
import com.mapbox.navigation.base.options.NavigationOptions
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.route.NavigationRouterCallback
import com.mapbox.navigation.base.route.RouterFailure
import com.mapbox.navigation.base.trip.model.RouteProgress
import com.mapbox.navigation.core.MapboxNavigation
import com.mapbox.navigation.core.MapboxNavigationProvider
import com.mapbox.navigation.core.arrival.ArrivalObserver
import com.mapbox.navigation.core.directions.session.RoutesObserver
import com.mapbox.navigation.core.directions.session.RoutesUpdatedResult
import com.mapbox.navigation.core.replay.route.ReplayRouteMapper
import com.mapbox.navigation.core.trip.session.LocationMatcherResult
import com.mapbox.navigation.core.trip.session.LocationObserver
import com.mapbox.navigation.core.trip.session.OffRouteObserver
import com.mapbox.navigation.core.trip.session.RouteProgressObserver
import com.mapbox.navigation.core.trip.session.VoiceInstructionsObserver
import com.mapbox.navigation.base.trip.model.RouteLegProgress
import com.mapbox.navigation.ui.base.util.MapboxNavigationConsumer
import com.mapbox.navigation.ui.maps.NavigationStyles
import com.mapbox.navigation.ui.maps.camera.NavigationCamera
import com.mapbox.navigation.ui.maps.camera.data.MapboxNavigationViewportDataSource
import com.mapbox.navigation.ui.maps.camera.lifecycle.NavigationBasicGesturesHandler
import com.mapbox.navigation.ui.maps.camera.state.NavigationCameraState
import com.mapbox.navigation.ui.maps.location.NavigationLocationProvider
import com.mapbox.navigation.ui.maps.route.line.api.MapboxRouteLineApi
import com.mapbox.navigation.ui.maps.route.line.api.MapboxRouteLineView
import com.mapbox.navigation.ui.maps.route.line.model.MapboxRouteLineApiOptions
import com.mapbox.navigation.ui.maps.route.line.model.MapboxRouteLineViewOptions
import com.mapbox.navigation.voice.api.MapboxSpeechApi
import com.mapbox.navigation.voice.api.MapboxVoiceInstructionsPlayer
import com.mapbox.navigation.voice.model.SpeechAnnouncement
import com.mapbox.navigation.voice.model.SpeechError
import com.mapbox.navigation.voice.model.SpeechValue
import com.mapbox.navigation.voice.model.SpeechVolume
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.Locale

/**
 * Native view that renders a Mapbox map and drives the Mapbox Navigation SDK (v3):
 *  - location puck + navigation camera (following / overview / idle)
 *  - route line rendering (primary + alternatives)
 *  - turn-by-turn progress events (banner text, distances, ETA)
 *  - voice guidance (Mapbox Voice API with TTS fallback)
 *  - route simulation (replay) for testing without driving
 */
@SuppressLint("ViewConstructor", "MissingPermission")
class MapboxNavigationView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  // ---------------------------------------------------------------- events
  private val onReady by EventDispatcher<Map<String, Any>>()
  private val onLocation by EventDispatcher<Map<String, Any>>()
  private val onRouteReady by EventDispatcher<Map<String, Any>>()
  private val onRouteError by EventDispatcher<Map<String, Any>>()
  private val onNavigationStarted by EventDispatcher<Map<String, Any>>()
  private val onNavigationStopped by EventDispatcher<Map<String, Any>>()
  private val onProgress by EventDispatcher<Map<String, Any>>()
  private val onOffRoute by EventDispatcher<Map<String, Any>>()
  private val onArrival by EventDispatcher<Map<String, Any>>()
  private val onCameraModeChanged by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  private val onMapPress by EventDispatcher<Map<String, Any>>()
  private val onMapLongPress by EventDispatcher<Map<String, Any>>()
  private val onMarkerPress by EventDispatcher<Map<String, Any>>()

  // ---------------------------------------------------------------- props (set from JS)
  private var explicitStyleUri: String? = null
  private var mapStyle: String = "streets"
  private var vehicle: String = "car"
  private var vehicleScale: Double = 8.0
  private var vehicleRotation: Double = 0.0
  private var theme: String = "system"
  private var units: String? = null
  private var showManeuverBanner: Boolean = true
  private var showSpeedLimit: Boolean = true
  private var topInsetDp: Double = 48.0
  private var speedLimitBottomMarginDp: Double = 210.0
  private var loadedStyleUri: String? = null
  private var currentNight: Boolean = false
  private var origin: Point? = null
  private var destination: Point? = null
  private var waypoints: List<Point> = emptyList()
  private var profile: String = DirectionsCriteria.PROFILE_DRIVING_TRAFFIC
  private var language: String = Locale.getDefault().language.ifEmpty { "en" }
  private var simulate: Boolean = false
  private var muted: Boolean = false
  private var simulationSpeed: Double = 1.0

  // ---------------------------------------------------------------- state
  private val density = context.resources.displayMetrics.density
  private val mapView: MapView
  private val navigationLocationProvider = NavigationLocationProvider()
  private val viewportDataSource: MapboxNavigationViewportDataSource
  private val navigationCamera: NavigationCamera
  private val routeLineApi = MapboxRouteLineApi(MapboxRouteLineApiOptions.Builder().build())
  private var routeLineView = createRouteLineView(LocationComponentConstants.MODEL_LAYER)
  private val container = FrameLayout(context)
  private var maneuverView: MapboxManeuverView? = null
  private var speedInfoView: MapboxSpeedInfoView? = null
  private var lastSpeedInfo: SpeedInfoValue? = null
  private var distanceFormatterOptions: DistanceFormatterOptions =
    DistanceFormatterOptions.Builder(context).build()
  private var maneuverApi = MapboxManeuverApi(MapboxDistanceFormatter(distanceFormatterOptions))
  private val speedInfoApi = MapboxSpeedInfoApi()
  private var pointAnnotationManager: PointAnnotationManager? = null   // destination pin
  private var markerManager: PointAnnotationManager? = null             // user markers (<Marker/>)
  private var showsUserLocation = true
  private var showDestinationPin = true
  private var lastEmittedMarkerId: String? = null
  private var lastEmittedMarkerAt = 0L
  private var zoomEnabled = true
  private var scrollEnabled = true
  private var rotateEnabled = true
  private var pitchEnabled = true
  private var markerSpecs: List<MarkerSpec> = emptyList()
  private val markerBitmaps = mutableMapOf<String, Bitmap>()
  private val markerAnnotations = mutableMapOf<String, PointAnnotation>()
  private val markerSignatures = mutableMapOf<String, String>()
  private val annotationToMarker = mutableMapOf<String, String>()
  private var lastMarkerPressAt = 0L
  private var cameraControlledByJs = false
  private var pinBitmap: Bitmap? = null
  private val gesturesHandler: NavigationBasicGesturesHandler

  private var mapboxNavigation: MapboxNavigation? = null
  private var isSetUp = false
  private var isDestroyed = false
  private var isNavigating = false
  private var pendingStart = false
  private var firstLocationReceived = false
  private var lastLocation: Location? = null
  private var currentRoutes: List<NavigationRoute> = emptyList()
  private var lastBannerPrimary: String? = null
  private var lastBannerSecondary: String? = null
  private var lastManeuverType: String? = null
  private var lastManeuverModifier: String? = null
  private var requestId: Long = -1L

  private var speechApi: MapboxSpeechApi? = null
  private var voicePlayer: MapboxVoiceInstructionsPlayer? = null

  init {
    MapboxTokenHelper.applyIfNeeded(context)

    addView(container, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    mapView = MapView(context)
    container.addView(
      mapView,
      FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    )

    val mapboxMap = mapView.mapboxMap
    currentNight = resolveNight()
    applyStyle()

    mapView.scalebar.enabled = false
    mapView.location.apply {
      setLocationProvider(navigationLocationProvider)
      puckBearingEnabled = true
      enabled = true
    }
    applyPuck()

    viewportDataSource = MapboxNavigationViewportDataSource(mapboxMap)
    viewportDataSource.followingPadding =
      EdgeInsets(200.0 * density, 40.0 * density, 160.0 * density, 40.0 * density)
    viewportDataSource.overviewPadding =
      EdgeInsets(160.0 * density, 40.0 * density, 160.0 * density, 40.0 * density)

    navigationCamera = NavigationCamera(mapboxMap, mapView.camera, viewportDataSource)
    gesturesHandler = NavigationBasicGesturesHandler(navigationCamera)
    mapView.camera.addCameraAnimationsLifecycleListener(gesturesHandler)
    navigationCamera.registerNavigationCameraStateChangeObserver { state ->
      onCameraModeChanged(mapOf("mode" to cameraModeName(state)))
    }

    mapView.gestures.addOnMapClickListener(OnMapClickListener { point ->
      handleMapClick(point)
      false
    })
    mapView.gestures.addOnMapLongClickListener(OnMapLongClickListener { point ->
      onMapLongPress(mapOf("latitude" to point.latitude(), "longitude" to point.longitude()))
      true
    })

    pointAnnotationManager = mapView.annotations.createPointAnnotationManager()
    markerManager = mapView.annotations.createPointAnnotationManager().also { manager ->
      manager.addClickListener(OnPointAnnotationClickListener { annotation ->
        annotationToMarker[annotation.id]?.let { markerId -> emitMarkerPress(markerId) }
        true
      })
    }
    applyGestures()
    buildOverlays()
  }

  /** Let Android lay out the MapView instead of Yoga. */
  override val shouldUseAndroidLayout: Boolean
    get() = true

  // =============================================================== prop setters
  fun setStyleUri(value: String?) {
    explicitStyleUri = value?.takeIf { it.isNotBlank() }
    applyStyle()
  }

  fun setMapStyle(value: String?) {
    mapStyle = value ?: "streets"
    applyStyle()
  }

  fun setShowDestinationPin(value: Boolean) {
    showDestinationPin = value
    updateDestinationPin()
  }

  fun setShowsUserLocation(value: Boolean) {
    showsUserLocation = value
    mapView.location.enabled = value
  }

  fun setZoomEnabled(value: Boolean) { zoomEnabled = value; applyGestures() }
  fun setScrollEnabled(value: Boolean) { scrollEnabled = value; applyGestures() }
  fun setRotateEnabled(value: Boolean) { rotateEnabled = value; applyGestures() }
  fun setPitchEnabled(value: Boolean) { pitchEnabled = value; applyGestures() }

  private fun applyGestures() {
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

  // ----------------------------------------------------------- camera (<Camera/>, like @rnmapbox/maps)
  data class CameraSpec(
    val centerCoordinate: List<Double>?,   // [longitude, latitude]
    val zoomLevel: Double?,
    val pitch: Double?,
    val heading: Double?,
    val animationMode: String?,            // flyTo | easeTo | linearTo | moveTo | none
    val animationDuration: Double?,        // ms
    val minZoomLevel: Double?,
    val maxZoomLevel: Double?,
  )

  fun applyCamera(spec: CameraSpec?) {
    if (spec == null) return
    cameraControlledByJs = true

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

    // an explicit camera request wins over the automatic navigation camera
    navigationCamera.requestNavigationCameraToIdle()

    val options = builder.build()
    val duration = (spec.animationDuration ?: 1000.0).toLong().coerceAtLeast(0L)
    when (spec.animationMode) {
      "flyTo" -> mapView.camera.flyTo(options, mapAnimationOptions { duration(duration) })
      "easeTo", "linearTo" -> mapView.camera.easeTo(options, mapAnimationOptions { duration(duration) })
      else -> mapView.mapboxMap.setCamera(options)
    }
  }

  // ----------------------------------------------------------- markers (<Marker/>)
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
    val images = value ?: emptyMap()
    markerBitmaps.keys.retainAll(images.keys)
    images.forEach { (key, base64) ->
      if (base64.isBlank() || markerBitmaps.containsKey(key)) return@forEach
      runCatching {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      }.getOrNull()?.let { markerBitmaps[key] = it }
    }
    syncMarkers()
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

    // 1) remove markers that disappeared or whose icon/anchor changed
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

    // 2) move markers whose coordinate changed
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

    // 3) create the new ones in a single batch
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

  fun setTheme(value: String?) {
    theme = value ?: "system"
    refreshTheme()
  }

  fun setUnits(value: String?) {
    units = value
    distanceFormatterOptions = if (value == null) {
      DistanceFormatterOptions.Builder(context).build()
    } else {
      DistanceFormatterOptions.Builder(context)
        .unitType(if (value == "imperial") UnitType.IMPERIAL else UnitType.METRIC)
        .build()
    }
    maneuverApi = MapboxManeuverApi(MapboxDistanceFormatter(distanceFormatterOptions))
  }

  fun setShowManeuverBanner(value: Boolean) {
    showManeuverBanner = value
    if (!value) maneuverView?.visibility = View.GONE
  }

  fun setShowSpeedLimit(value: Boolean) {
    showSpeedLimit = value
    if (!value) speedInfoView?.visibility = View.GONE
  }

  fun setTopInset(value: Double?) {
    topInsetDp = value ?: 48.0
    buildOverlays()
  }

  fun setSpeedLimitBottomMargin(value: Double?) {
    speedLimitBottomMarginDp = value ?: 210.0
    buildOverlays()
  }

  fun setOrigin(value: Point?) { origin = value }
  fun setDestination(value: Point?) {
    destination = value
    updateDestinationPin()
  }
  fun setWaypoints(value: List<Point>?) { waypoints = value ?: emptyList() }

  fun setProfile(value: String?) {
    profile = when (value) {
      "driving" -> DirectionsCriteria.PROFILE_DRIVING
      "walking" -> DirectionsCriteria.PROFILE_WALKING
      "cycling" -> DirectionsCriteria.PROFILE_CYCLING
      else -> DirectionsCriteria.PROFILE_DRIVING_TRAFFIC
    }
  }

  fun setLanguage(value: String?) {
    val newLanguage = value?.takeIf { it.isNotBlank() } ?: Locale.getDefault().language.ifEmpty { "en" }
    if (newLanguage == language) return
    language = newLanguage
    if (isSetUp) {
      releaseVoice()
      createVoice()
    }
  }

  fun setSimulate(value: Boolean) { simulate = value }
  fun setSimulationSpeed(value: Double?) { simulationSpeed = (value ?: 1.0).coerceIn(0.5, 8.0) }

  fun setMuted(value: Boolean) {
    muted = value
    if (muted) voicePlayer?.clear()
    voicePlayer?.volume(SpeechVolume(if (muted) 0f else 1f))
  }

  // =============================================================== lifecycle
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!isSetUp && !isDestroyed) setUp()
  }

  private fun setUp() {
    try {
      val navigation = if (MapboxNavigationProvider.isCreated()) {
        MapboxNavigationProvider.retrieve()
      } else {
        MapboxNavigationProvider.create(
          NavigationOptions.Builder(context.applicationContext).build()
        )
      }
      mapboxNavigation = navigation

      navigation.registerLocationObserver(locationObserver)
      navigation.registerRouteProgressObserver(routeProgressObserver)
      navigation.registerRoutesObserver(routesObserver)
      navigation.registerOffRouteObserver(offRouteObserver)
      navigation.registerArrivalObserver(arrivalObserver)
      navigation.registerVoiceInstructionsObserver(voiceInstructionsObserver)

      createVoice()

      // Free-drive session (real GPS, no foreground service) so the puck & camera work before navigation.
      navigation.startTripSession(withForegroundService = false)
      isSetUp = true
      onReady(mapOf("ready" to true))
    } catch (t: Throwable) {
      emitError("SETUP_FAILED", t.message ?: "Failed to initialise Mapbox Navigation")
    }
  }

  /** Called from the module when React Native drops the view. */
  fun cleanup() {
    if (isDestroyed) return
    isDestroyed = true
    try {
      requestId.takeIf { it >= 0 }?.let { mapboxNavigation?.cancelRouteRequest(it) }
      mapboxNavigation?.let { nav ->
        nav.unregisterLocationObserver(locationObserver)
        nav.unregisterRouteProgressObserver(routeProgressObserver)
        nav.unregisterRoutesObserver(routesObserver)
        nav.unregisterOffRouteObserver(offRouteObserver)
        nav.unregisterArrivalObserver(arrivalObserver)
        nav.unregisterVoiceInstructionsObserver(voiceInstructionsObserver)
        nav.mapboxReplayer.stop()
        nav.mapboxReplayer.clearEvents()
        nav.setNavigationRoutes(emptyList())
        nav.stopTripSession()
      }
      releaseVoice()
      routeLineApi.cancel()
      routeLineView.cancel()
      maneuverApi.cancel()
      mapView.camera.removeCameraAnimationsLifecycleListener(gesturesHandler)
      if (MapboxNavigationProvider.isCreated()) MapboxNavigationProvider.destroy()
      mapView.onDestroy()
    } catch (_: Throwable) {
      // best-effort cleanup
    } finally {
      mapboxNavigation = null
      isSetUp = false
    }
  }

  // =============================================================== commands (called from JS)
  /** Requests routes with the current props and shows them as a preview. */
  fun fetchRoute() {
    val navigation = mapboxNavigation ?: return emitError("NOT_READY", "Navigation is not ready yet")
    val dest = destination ?: return emitRouteError("NO_DESTINATION", "destination prop is required")
    val start = origin
      ?: lastLocation?.let { Point.fromLngLat(it.longitude, it.latitude) }
      ?: return emitRouteError("NO_ORIGIN", "Waiting for a GPS fix – pass `origin` or try again in a moment")

    val coordinates = mutableListOf(start).apply {
      addAll(waypoints)
      add(dest)
    }

    val routeOptions = RouteOptions.builder()
      .applyDefaultNavigationOptions(profile)
      .applyLanguageAndVoiceUnitOptions(context)
      .language(language)
      .apply {
        units?.let { voiceUnits(if (it == "imperial") UnitType.IMPERIAL.value else UnitType.METRIC.value) }
      }
      .coordinatesList(coordinates)
      .alternatives(true)
      .build()

    requestId.takeIf { it >= 0 }?.let { navigation.cancelRouteRequest(it) }
    requestId = navigation.requestRoutes(
      routeOptions,
      object : NavigationRouterCallback {
        override fun onRoutesReady(routes: List<NavigationRoute>, routerOrigin: String) {
          if (isDestroyed) return
          if (routes.isEmpty()) {
            pendingStart = false
            emitRouteError("NO_ROUTE", "No route found")
            return
          }
          navigation.setNavigationRoutes(routes)
          val primary = routes.first().directionsRoute
          onRouteReady(
            mapOf(
              "distance" to (primary.distance() ?: 0.0),
              "duration" to (primary.duration() ?: 0.0),
              "routeCount" to routes.size,
            )
          )
          navigationCamera.requestNavigationCameraToOverview()
          if (pendingStart) {
            pendingStart = false
            beginNavigation(navigation, routes)
          }
        }

        override fun onFailure(reasons: List<RouterFailure>, routeOptions: RouteOptions) {
          pendingStart = false
          emitRouteError(
            "ROUTE_REQUEST_FAILED",
            reasons.joinToString("; ") { it.message }.ifEmpty { "Route request failed" }
          )
        }

        override fun onCanceled(routeOptions: RouteOptions, routerOrigin: String) {
          pendingStart = false
        }
      }
    )
  }

  /** Starts turn-by-turn navigation (fetches a route first if there is none). */
  fun startNavigation() {
    val navigation = mapboxNavigation ?: return emitError("NOT_READY", "Navigation is not ready yet")
    if (isNavigating) return
    if (currentRoutes.isEmpty()) {
      pendingStart = true
      fetchRoute()
      return
    }
    beginNavigation(navigation)
  }

  fun stopNavigation() {
    val navigation = mapboxNavigation ?: return
    pendingStart = false
    val wasNavigating = isNavigating
    isNavigating = false
    maneuverView?.visibility = View.GONE
    voicePlayer?.clear()
    speechApi?.cancel()
    navigation.mapboxReplayer.stop()
    navigation.mapboxReplayer.clearEvents()
    navigation.setNavigationRoutes(emptyList())
    navigation.stopTripSession()
    navigation.startTripSession(withForegroundService = false)
    lastBannerPrimary = null
    lastBannerSecondary = null
    lastManeuverType = null
    lastManeuverModifier = null
    recenter()
    if (wasNavigating) onNavigationStopped(mapOf("reason" to "stopped"))
  }

  fun recenter() {
    if (isNavigating) {
      navigationCamera.requestNavigationCameraToFollowing()
      return
    }
    val location = lastLocation ?: return
    navigationCamera.requestNavigationCameraToIdle()
    mapView.camera.flyTo(
      CameraOptions.Builder()
        .center(Point.fromLngLat(location.longitude, location.latitude))
        .zoom(15.0)
        .pitch(0.0)
        .bearing(0.0)
        .build(),
      mapAnimationOptions { duration(900L) }
    )
  }

  fun showOverview() {
    navigationCamera.requestNavigationCameraToOverview()
  }

  // =============================================================== internals
  private fun beginNavigation(
    navigation: MapboxNavigation,
    routes: List<NavigationRoute> = currentRoutes,
  ) {
    val primaryRoute = routes.firstOrNull()
    if (primaryRoute == null) {
      emitRouteError("NO_ROUTE", "No route available to start navigation")
      return
    }
    isNavigating = true
    navigation.stopTripSession()
    if (simulate) {
      navigation.startReplayTripSession(withForegroundService = false)
      val replayer = navigation.mapboxReplayer
      val events = ReplayRouteMapper().mapDirectionsRouteGeometry(primaryRoute.directionsRoute)
      replayer.stop()
      replayer.clearEvents()
      replayer.pushEvents(events)
      replayer.seekTo(events.first())
      replayer.playbackSpeed(simulationSpeed)
      replayer.play()
    } else {
      navigation.startTripSession(withForegroundService = true)
    }
    if (showManeuverBanner) maneuverView?.visibility = View.VISIBLE
    navigationCamera.requestNavigationCameraToFollowing()
    onNavigationStarted(mapOf("simulated" to simulate))
  }

  // ----------------------------------------------------------- theme / style
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
      "streets" ->
        if (night) "mapbox://styles/mapbox/dark-v11" else "mapbox://styles/mapbox/streets-v12"
      "outdoors" -> "mapbox://styles/mapbox/outdoors-v12"
      "satellite" -> "mapbox://styles/mapbox/satellite-streets-v12"
      else ->
        if (night) NavigationStyles.NAVIGATION_NIGHT_STYLE else NavigationStyles.NAVIGATION_DAY_STYLE
    }
  }

  private fun applyStyle() {
    val uri = resolveStyleUri(currentNight)
    if (uri == loadedStyleUri) return
    loadedStyleUri = uri
    routeLineView.cancel()
    routeLineView = createRouteLineView(routeLineBelowLayer())
    mapView.mapboxMap.loadStyle(uri) {
      renderRoutes()
      // the puck layers are added right after the style: render again so the route sits BELOW them
      mapView.postDelayed({ renderRoutes() }, 400)
    }
  }

  private fun refreshTheme() {
    val night = resolveNight()
    if (night != currentNight) {
      currentNight = night
      buildOverlays()
    }
    applyStyle()
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    refreshTheme()
  }

  /** Route line must be drawn under the location puck so the FS vehicle (and its logo) stays visible. */
  private fun routeLineBelowLayer(): String =
    if (vehicle == "car" || vehicle == "bike") {
      LocationComponentConstants.MODEL_LAYER
    } else {
      LocationComponentConstants.LOCATION_INDICATOR_LAYER
    }

  private fun createRouteLineView(belowLayerId: String): MapboxRouteLineView =
    MapboxRouteLineView(
      MapboxRouteLineViewOptions.Builder(context)
        .routeLineBelowLayerId(belowLayerId)
        .build()
    )

  private fun dp(value: Double): Int = (value * density).toInt()

  /** Context whose resources follow the resolved day/night mode + a Material theme (needed by Mapbox views). */
  private fun themedContext(night: Boolean): Context {
    val config = Configuration(context.resources.configuration)
    config.uiMode = (config.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
      (if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
    return ContextThemeWrapper(
      context.createConfigurationContext(config),
      com.google.android.material.R.style.Theme_MaterialComponents_DayNight_NoActionBar
    )
  }

  /** (Re)creates Mapbox's official maneuver banner + speed-limit sign. */
  private fun buildOverlays() {
    maneuverView?.let { container.removeView(it) }
    speedInfoView?.let { container.removeView(it) }
    val themed = themedContext(currentNight)

    val maneuver = MapboxManeuverView(themed)
    maneuver.visibility = if (isNavigating && showManeuverBanner) View.VISIBLE else View.GONE
    container.addView(
      maneuver,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.TOP
      ).apply { setMargins(dp(8.0), dp(topInsetDp), dp(8.0), 0) }
    )
    maneuverView = maneuver

    val speed = MapboxSpeedInfoView(themed)
    speed.applyOptions(MapboxSpeedInfoOptions.Builder().build())
    speed.visibility = View.GONE
    container.addView(
      speed,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM or Gravity.START
      ).apply { setMargins(dp(12.0), 0, 0, dp(speedLimitBottomMarginDp)) }
    )
    speedInfoView = speed
    lastSpeedInfo?.let {
      speed.render(it)
      if (showSpeedLimit) speed.visibility = View.VISIBLE
    }
  }

  // ----------------------------------------------------------- vehicle puck (3D FS models)
  private fun applyPuck() {
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
      else -> LocationPuck2D(
        bearingImage = ImageHolder.from(
          com.mapbox.navigation.ui.maps.R.drawable.mapbox_navigation_puck_icon
        )
      )
    }
    // keep the route under the (possibly different) puck layer
    if (loadedStyleUri != null) {
      routeLineView.cancel()
      routeLineView = createRouteLineView(routeLineBelowLayer())
      mapView.postDelayed({ renderRoutes() }, 400)
    }
  }

  // ----------------------------------------------------------- marker presses
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

  // ----------------------------------------------------------- map taps (places / POIs)
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

  // ----------------------------------------------------------- destination pin
  private fun createPinBitmap(): Bitmap {
    val w = dp(34.0)
    val h = dp(46.0)
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
    if (!showDestinationPin || currentRoutes.isNotEmpty()) return
    val icon = pinBitmap ?: createPinBitmap().also { pinBitmap = it }
    manager.create(
      PointAnnotationOptions()
        .withPoint(point)
        .withIconImage(icon)
        .withIconAnchor(IconAnchor.BOTTOM)
    )
  }

  private fun renderRoutes() {
    if (currentRoutes.isEmpty()) return
    routeLineApi.setNavigationRoutes(currentRoutes) { value ->
      mapView.mapboxMap.style?.let { routeLineView.renderRouteDrawData(it, value) }
    }
  }

  private fun createVoice() {
    speechApi = MapboxSpeechApi(context, language)
    voicePlayer = MapboxVoiceInstructionsPlayer(context, language).also {
      it.volume(SpeechVolume(if (muted) 0f else 1f))
    }
  }

  private fun releaseVoice() {
    speechApi?.cancel()
    voicePlayer?.shutdown()
    speechApi = null
    voicePlayer = null
  }

  private fun cameraModeName(state: NavigationCameraState): String = when (state) {
    NavigationCameraState.FOLLOWING, NavigationCameraState.TRANSITION_TO_FOLLOWING -> "following"
    NavigationCameraState.OVERVIEW, NavigationCameraState.TRANSITION_TO_OVERVIEW -> "overview"
    else -> "idle"
  }

  private fun emitError(code: String, message: String) {
    onError(mapOf("code" to code, "message" to message))
  }

  private fun emitRouteError(code: String, message: String) {
    onRouteError(mapOf("code" to code, "message" to message))
  }

  // =============================================================== observers
  private val locationObserver = object : LocationObserver {
    override fun onNewRawLocation(rawLocation: Location) {}

    override fun onNewLocationMatcherResult(locationMatcherResult: LocationMatcherResult) {
      val location = locationMatcherResult.enhancedLocation
      lastLocation = location
      navigationLocationProvider.changePosition(
        location = location,
        keyPoints = locationMatcherResult.keyPoints,
      )
      viewportDataSource.onLocationChanged(location)
      viewportDataSource.evaluate()

      if (!firstLocationReceived) {
        firstLocationReceived = true
        if (!cameraControlledByJs) mapView.mapboxMap.setCamera(
          CameraOptions.Builder()
            .center(Point.fromLngLat(location.longitude, location.latitude))
            .zoom(15.0)
            .pitch(0.0)
            .bearing(0.0)
            .build()
        )
      }

      speedInfoApi.updatePostedAndCurrentSpeed(locationMatcherResult, distanceFormatterOptions)
        ?.let { value ->
          lastSpeedInfo = value
          speedInfoView?.let { view ->
            view.render(value)
            view.visibility = if (showSpeedLimit) View.VISIBLE else View.GONE
          }
        }

      val payload = mutableMapOf<String, Any>(
        "latitude" to location.latitude,
        "longitude" to location.longitude,
      )
      location.speed?.let { payload["speed"] = it.toDouble() }
      location.bearing?.let { payload["bearing"] = it.toDouble() }
      onLocation(payload)
    }
  }

  private val routesObserver = object : RoutesObserver {
    override fun onRoutesChanged(result: RoutesUpdatedResult) {
      currentRoutes = result.navigationRoutes
      updateDestinationPin()
      if (currentRoutes.isNotEmpty()) {
        routeLineApi.setNavigationRoutes(currentRoutes) { value ->
          mapView.mapboxMap.style?.let { routeLineView.renderRouteDrawData(it, value) }
        }
        viewportDataSource.onRouteChanged(currentRoutes.first())
        viewportDataSource.evaluate()
      } else {
        routeLineApi.clearRouteLine { value ->
          mapView.mapboxMap.style?.let { routeLineView.renderClearRouteLineValue(it, value) }
        }
        viewportDataSource.clearRouteData()
        viewportDataSource.evaluate()
      }
    }
  }

  private val routeProgressObserver = RouteProgressObserver { routeProgress: RouteProgress ->
    viewportDataSource.onRouteProgressChanged(routeProgress)
    viewportDataSource.evaluate()

    routeLineApi.updateWithRouteProgress(routeProgress) { result ->
      mapView.mapboxMap.style?.let { routeLineView.renderRouteLineUpdate(it, result) }
    }

    if (isNavigating && showManeuverBanner) {
      maneuverView?.let { view ->
        view.visibility = View.VISIBLE
        view.renderManeuvers(maneuverApi.getManeuvers(routeProgress))
      }
    }

    routeProgress.bannerInstructions?.let { banner ->
      lastBannerPrimary = banner.primary().text()
      lastBannerSecondary = banner.secondary()?.text()
      lastManeuverType = banner.primary().type()
      lastManeuverModifier = banner.primary().modifier()
    }

    val payload = mutableMapOf<String, Any>(
      "distanceRemaining" to routeProgress.distanceRemaining.toDouble(),
      "durationRemaining" to routeProgress.durationRemaining,
      "fractionTraveled" to routeProgress.fractionTraveled.toDouble(),
      "stepDistanceRemaining" to (
        routeProgress.currentLegProgress?.currentStepProgress?.distanceRemaining?.toDouble() ?: 0.0
        ),
    )
    routeProgress.currentLegProgress?.currentStepProgress?.step?.name()
      ?.takeIf { it.isNotBlank() }
      ?.let { payload["roadName"] = it }
    lastSpeedInfo?.let { info ->
      info.postedSpeed?.let { payload["speedLimit"] = it.toDouble() }
      payload["speedUnit"] = if (info.postedSpeedUnit == SpeedUnit.MILES_PER_HOUR) "mph" else "km/h"
      payload["currentSpeed"] = info.currentSpeed.toDouble()
    }
    lastBannerPrimary?.let { payload["instruction"] = it }
    lastBannerSecondary?.let { payload["secondaryInstruction"] = it }
    lastManeuverType?.let { payload["maneuverType"] = it }
    lastManeuverModifier?.let { payload["maneuverModifier"] = it }
    onProgress(payload)
  }

  private val offRouteObserver = object : OffRouteObserver {
    override fun onOffRouteStateChanged(offRoute: Boolean) {
      onOffRoute(mapOf("offRoute" to offRoute))
    }
  }

  private val arrivalObserver = object : ArrivalObserver {
    override fun onWaypointArrival(routeProgress: RouteProgress) {
      onArrival(mapOf("final" to false))
    }

    override fun onNextRouteLegStart(routeLegProgress: RouteLegProgress) {}

    override fun onFinalDestinationArrival(routeProgress: RouteProgress) {
      onArrival(mapOf("final" to true))
    }
  }

  // ----------------------------------------------------------- voice guidance
  private val voicePlayerCallback = MapboxNavigationConsumer<SpeechAnnouncement> { announcement ->
    speechApi?.clean(announcement)
  }

  private val speechCallback =
    MapboxNavigationConsumer<Expected<SpeechError, SpeechValue>> { expected ->
      expected.fold(
        { error -> voicePlayer?.play(error.fallback, voicePlayerCallback) },
        { value -> voicePlayer?.play(value.announcement, voicePlayerCallback) },
      )
    }

  private val voiceInstructionsObserver = VoiceInstructionsObserver { voiceInstructions ->
    if (!muted) speechApi?.generate(voiceInstructions, speechCallback)
  }

  companion object {
    private val POI_SOURCE_LAYERS = setOf(
      "poi_label",
      "transit_stop_label",
      "airport_label",
      "natural_label",
    )
  }
}
