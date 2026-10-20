package expo.modules.mapboxnavigation

import com.mapbox.common.MapboxOptions
import com.mapbox.geojson.Point
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CoordinateRecord : Record {
  @Field
  var latitude: Double = 0.0

  @Field
  var longitude: Double = 0.0

  fun toPoint(): Point = Point.fromLngLat(longitude, latitude)
}

class MarkerRecord : Record {
  @Field
  var id: String = ""

  @Field
  var latitude: Double = 0.0

  @Field
  var longitude: Double = 0.0

  @Field
  var icon: String = ""

  @Field
  var anchorX: Double = 0.5

  @Field
  var anchorY: Double = 1.0
}

class CameraRecord : Record {
  @Field
  var centerCoordinate: List<Double>? = null

  @Field
  var zoomLevel: Double? = null

  @Field
  var pitch: Double? = null

  @Field
  var heading: Double? = null

  @Field
  var animationMode: String? = null

  @Field
  var animationDuration: Double? = null

  @Field
  var minZoomLevel: Double? = null

  @Field
  var maxZoomLevel: Double? = null

  fun toSpec() = MapboxNavigationView.CameraSpec(
    centerCoordinate, zoomLevel, pitch, heading, animationMode, animationDuration, minZoomLevel, maxZoomLevel
  )
}

class MapboxNavigationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MapboxNavigation")

    OnCreate {
      appContext.reactContext?.let { MapboxTokenHelper.applyIfNeeded(it) }
    }

    /** Set / override the public access token at runtime (must be called before the view mounts). */
    Function("setAccessToken") { token: String ->
      MapboxOptions.accessToken = token
    }

    Function("getAccessToken") {
      runCatching { MapboxOptions.accessToken }.getOrDefault("")
    }

    Function("hasAccessToken") {
      MapboxTokenHelper.hasToken()
    }

    View(MapboxNavigationView::class) {
      Events(
        "onReady",
        "onLocation",
        "onRouteReady",
        "onRouteError",
        "onNavigationStarted",
        "onNavigationStopped",
        "onProgress",
        "onOffRoute",
        "onArrival",
        "onCameraModeChanged",
        "onError",
        "onMapPress",
        "onMapLongPress",
        "onMarkerPress"
      )

      Prop("styleURL") { view: MapboxNavigationView, value: String? -> view.setStyleUri(value) }
      Prop("origin") { view: MapboxNavigationView, value: CoordinateRecord? ->
        view.setOrigin(value?.toPoint())
      }
      Prop("destination") { view: MapboxNavigationView, value: CoordinateRecord? ->
        view.setDestination(value?.toPoint())
      }
      Prop("waypoints") { view: MapboxNavigationView, value: List<CoordinateRecord>? ->
        view.setWaypoints(value?.map { it.toPoint() })
      }
      Prop("showDestinationPin") { view: MapboxNavigationView, value: Boolean? ->
        view.setShowDestinationPin(value ?: true)
      }
      Prop("showsUserLocation") { view: MapboxNavigationView, value: Boolean? ->
        view.setShowsUserLocation(value ?: true)
      }
      Prop("zoomEnabled") { view: MapboxNavigationView, value: Boolean? -> view.setZoomEnabled(value ?: true) }
      Prop("scrollEnabled") { view: MapboxNavigationView, value: Boolean? -> view.setScrollEnabled(value ?: true) }
      Prop("rotateEnabled") { view: MapboxNavigationView, value: Boolean? -> view.setRotateEnabled(value ?: true) }
      Prop("pitchEnabled") { view: MapboxNavigationView, value: Boolean? -> view.setPitchEnabled(value ?: true) }
      Prop("camera") { view: MapboxNavigationView, value: CameraRecord? -> view.applyCamera(value?.toSpec()) }
      Prop("markers") { view: MapboxNavigationView, value: List<MarkerRecord>? ->
        view.setMarkers(
          value?.map {
            MapboxNavigationView.MarkerSpec(it.id, it.latitude, it.longitude, it.icon, it.anchorX, it.anchorY)
          }
        )
      }
      Prop("markerImages") { view: MapboxNavigationView, value: Map<String, String>? ->
        view.setMarkerImages(value)
      }
      Prop("vehicle") { view: MapboxNavigationView, value: String? -> view.setVehicle(value) }
      Prop("vehicleScale") { view: MapboxNavigationView, value: Double? -> view.setVehicleScale(value) }
      Prop("vehicleRotation") { view: MapboxNavigationView, value: Double? -> view.setVehicleRotation(value) }
      Prop("mapStyle") { view: MapboxNavigationView, value: String? -> view.setMapStyle(value) }
      Prop("theme") { view: MapboxNavigationView, value: String? -> view.setTheme(value) }
      Prop("units") { view: MapboxNavigationView, value: String? -> view.setUnits(value) }
      Prop("showManeuverBanner") { view: MapboxNavigationView, value: Boolean? ->
        view.setShowManeuverBanner(value ?: true)
      }
      Prop("showSpeedLimit") { view: MapboxNavigationView, value: Boolean? ->
        view.setShowSpeedLimit(value ?: true)
      }
      Prop("topInset") { view: MapboxNavigationView, value: Double? -> view.setTopInset(value) }
      Prop("speedLimitBottomMargin") { view: MapboxNavigationView, value: Double? ->
        view.setSpeedLimitBottomMargin(value)
      }
      Prop("profile") { view: MapboxNavigationView, value: String? -> view.setProfile(value) }
      Prop("language") { view: MapboxNavigationView, value: String? -> view.setLanguage(value) }
      Prop("simulate") { view: MapboxNavigationView, value: Boolean? -> view.setSimulate(value ?: false) }
      Prop("simulationSpeed") { view: MapboxNavigationView, value: Double? ->
        view.setSimulationSpeed(value)
      }
      Prop("muted") { view: MapboxNavigationView, value: Boolean? -> view.setMuted(value ?: false) }

      // View commands – callable from JS through a ref.
      AsyncFunction("fetchRoute") { view: MapboxNavigationView -> view.fetchRoute() }
      AsyncFunction("startNavigation") { view: MapboxNavigationView -> view.startNavigation() }
      AsyncFunction("stopNavigation") { view: MapboxNavigationView -> view.stopNavigation() }
      AsyncFunction("setCamera") { view: MapboxNavigationView, camera: CameraRecord -> view.applyCamera(camera.toSpec()) }
      AsyncFunction("recenter") { view: MapboxNavigationView -> view.recenter() }
      AsyncFunction("showOverview") { view: MapboxNavigationView -> view.showOverview() }

      OnViewDestroys { view: MapboxNavigationView -> view.cleanup() }
    }
  }
}
