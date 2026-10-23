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
        "onCameraModeChanged",
        "onError",
        "onMapPress",
        "onMapLongPress",
        "onMarkerPress"
      )

      // ---- look & feel
      Prop("styleURL") { view: MapboxNavigationView, value: String? -> view.setStyleUri(value) }
      Prop("mapStyle") { view: MapboxNavigationView, value: String? -> view.setMapStyle(value) }
      Prop("theme") { view: MapboxNavigationView, value: String? -> view.setTheme(value) }
      Prop("vehicle") { view: MapboxNavigationView, value: String? -> view.setVehicle(value) }
      Prop("vehicleScale") { view: MapboxNavigationView, value: Double? -> view.setVehicleScale(value) }
      Prop("vehicleRotation") { view: MapboxNavigationView, value: Double? -> view.setVehicleRotation(value) }

      // ---- react-native-maps style props
      Prop("showsUserLocation") { view: MapboxNavigationView, value: Boolean? -> view.setShowsUserLocation(value ?: true) }
      Prop("showDestinationPin") { view: MapboxNavigationView, value: Boolean? -> view.setShowDestinationPin(value ?: true) }
      Prop("destination") { view: MapboxNavigationView, value: CoordinateRecord? -> view.setDestination(value?.toPoint()) }
      Prop("zoomEnabled") { view: MapboxNavigationView, value: Boolean? -> view.setZoomEnabled(value ?: true) }
      Prop("scrollEnabled") { view: MapboxNavigationView, value: Boolean? -> view.setScrollEnabled(value ?: true) }
      Prop("rotateEnabled") { view: MapboxNavigationView, value: Boolean? -> view.setRotateEnabled(value ?: true) }
      Prop("pitchEnabled") { view: MapboxNavigationView, value: Boolean? -> view.setPitchEnabled(value ?: true) }

      // ---- camera + markers
      Prop("camera") { view: MapboxNavigationView, value: CameraRecord? -> view.applyCamera(value?.toSpec()) }
      Prop("markers") { view: MapboxNavigationView, value: List<MarkerRecord>? ->
        view.setMarkers(
          value?.map {
            MapboxNavigationView.MarkerSpec(it.id, it.latitude, it.longitude, it.icon, it.anchorX, it.anchorY)
          }
        )
      }
      Prop("markerImages") { view: MapboxNavigationView, value: Map<String, String>? -> view.setMarkerImages(value) }

      // ---- primitives driven by the TypeScript NavigationController
      AsyncFunction("updateLocation") { view: MapboxNavigationView, lat: Double, lng: Double, bearing: Double, _accuracy: Double, duration: Double ->
        view.updateLocation(lat, lng, bearing, duration)
      }
      AsyncFunction("followCamera") { view: MapboxNavigationView, lat: Double, lng: Double, bearing: Double, zoom: Double, pitch: Double, duration: Double ->
        view.followCamera(lat, lng, bearing, zoom, pitch, duration)
      }
      AsyncFunction("fitCamera") { view: MapboxNavigationView, coordinates: List<List<Double>>, top: Double, right: Double, bottom: Double, left: Double, duration: Double ->
        view.fitCamera(coordinates, top, right, bottom, left, duration)
      }
      AsyncFunction("setRoute") { view: MapboxNavigationView, geoJson: String, gradient: String -> view.setRoute(geoJson, gradient) }
      AsyncFunction("setAlternatives") { view: MapboxNavigationView, geoJson: String -> view.setAlternatives(geoJson) }
      AsyncFunction("setRouteProgress") { view: MapboxNavigationView, fraction: Double -> view.setRouteProgress(fraction) }
      AsyncFunction("clearRoute") { view: MapboxNavigationView -> view.clearRoute() }
      AsyncFunction("setCamera") { view: MapboxNavigationView, camera: CameraRecord -> view.applyCamera(camera.toSpec()) }

      OnViewDestroys { view: MapboxNavigationView -> view.cleanup() }
    }
  }
}
