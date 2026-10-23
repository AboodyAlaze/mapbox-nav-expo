import CoreLocation
import ExpoModulesCore
import MapboxCommon

struct CoordinateRecord: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
}

struct MarkerRecord: Record {
  @Field var id: String = ""
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var icon: String = ""
  @Field var anchorX: Double = 0.5
  @Field var anchorY: Double = 1.0
}

struct CameraRecord: Record {
  @Field var centerCoordinate: [Double]?
  @Field var zoomLevel: Double?
  @Field var pitch: Double?
  @Field var heading: Double?
  @Field var animationMode: String?
  @Field var animationDuration: Double?
  @Field var minZoomLevel: Double?
  @Field var maxZoomLevel: Double?
}

/// Reads the public token from Info.plist (`MBXAccessToken`, written by the config plugin).
enum MapboxTokenHelper {
  static func applyIfNeeded() {
    if !MapboxOptions.accessToken.isEmpty { return }
    if let token = Bundle.main.object(forInfoDictionaryKey: "MBXAccessToken") as? String, !token.isEmpty {
      MapboxOptions.accessToken = token
    }
  }
}

public class MapboxNavigationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MapboxNavigation")

    OnCreate {
      MapboxTokenHelper.applyIfNeeded()
    }

    Function("setAccessToken") { (token: String) in
      MapboxOptions.accessToken = token
    }

    Function("getAccessToken") { () -> String in
      MapboxTokenHelper.applyIfNeeded()
      return MapboxOptions.accessToken
    }

    Function("hasAccessToken") { () -> Bool in
      MapboxTokenHelper.applyIfNeeded()
      return !MapboxOptions.accessToken.isEmpty
    }

    View(MapboxNavigationView.self) {
      Events(
        "onReady",
        "onCameraModeChanged",
        "onError",
        "onMapPress",
        "onMapLongPress",
        "onMarkerPress"
      )

      // ---- look & feel
      Prop("styleURL") { (view: MapboxNavigationView, value: String?) in view.setStyleUri(value) }
      Prop("mapStyle") { (view: MapboxNavigationView, value: String?) in view.setMapStyle(value) }
      Prop("theme") { (view: MapboxNavigationView, value: String?) in view.setTheme(value) }
      Prop("vehicle") { (view: MapboxNavigationView, value: String?) in view.setVehicle(value) }
      Prop("vehicleScale") { (view: MapboxNavigationView, value: Double?) in view.setVehicleScale(value) }
      Prop("vehicleRotation") { (view: MapboxNavigationView, value: Double?) in view.setVehicleRotation(value) }

      // ---- react-native-maps style props
      Prop("showsUserLocation") { (view: MapboxNavigationView, value: Bool?) in view.setShowsUserLocation(value ?? true) }
      Prop("showDestinationPin") { (view: MapboxNavigationView, value: Bool?) in view.setShowDestinationPin(value ?? true) }
      Prop("destination") { (view: MapboxNavigationView, value: CoordinateRecord?) in
        view.setDestination(value.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) })
      }
      Prop("zoomEnabled") { (view: MapboxNavigationView, value: Bool?) in view.setZoomEnabled(value ?? true) }
      Prop("scrollEnabled") { (view: MapboxNavigationView, value: Bool?) in view.setScrollEnabled(value ?? true) }
      Prop("rotateEnabled") { (view: MapboxNavigationView, value: Bool?) in view.setRotateEnabled(value ?? true) }
      Prop("pitchEnabled") { (view: MapboxNavigationView, value: Bool?) in view.setPitchEnabled(value ?? true) }

      // ---- camera + markers
      Prop("camera") { (view: MapboxNavigationView, value: CameraRecord?) in view.applyCamera(value) }
      Prop("markers") { (view: MapboxNavigationView, value: [MarkerRecord]?) in view.setMarkers(value ?? []) }
      Prop("markerImages") { (view: MapboxNavigationView, value: [String: String]?) in
        view.setMarkerImages(value ?? [:])
      }

      // ---- primitives driven by the TypeScript NavigationController
      AsyncFunction("updateLocation") {
        (view: MapboxNavigationView, lat: Double, lng: Double, bearing: Double, accuracy: Double, duration: Double) in
        view.updateLocation(lat: lat, lng: lng, bearing: bearing, accuracy: accuracy)
      }
      AsyncFunction("followCamera") {
        (view: MapboxNavigationView, lat: Double, lng: Double, bearing: Double, zoom: Double, pitch: Double, duration: Double) in
        view.followCamera(lat: lat, lng: lng, bearing: bearing, zoom: zoom, pitch: pitch, durationMs: duration)
      }
      AsyncFunction("fitCamera") {
        (view: MapboxNavigationView, coordinates: [[Double]], top: Double, right: Double, bottom: Double, left: Double, duration: Double) in
        view.fitCamera(coordinates, top: top, right: right, bottom: bottom, left: left, durationMs: duration)
      }
      AsyncFunction("setRoute") { (view: MapboxNavigationView, geoJson: String, gradient: String) in
        view.setRoute(geoJson: geoJson, gradient: gradient)
      }
      AsyncFunction("setAlternatives") { (view: MapboxNavigationView, geoJson: String) in
        view.setAlternatives(geoJson: geoJson)
      }
      AsyncFunction("setRouteProgress") { (view: MapboxNavigationView, fraction: Double) in
        view.setRouteProgress(fraction)
      }
      AsyncFunction("clearRoute") { (view: MapboxNavigationView) in view.clearRoute() }
      AsyncFunction("setCamera") { (view: MapboxNavigationView, camera: CameraRecord) in view.applyCamera(camera) }
    }
  }
}
