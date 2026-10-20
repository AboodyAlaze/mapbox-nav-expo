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

      Prop("styleURL") { (view: MapboxNavigationView, value: String?) in view.setStyleUri(value) }
      Prop("origin") { (view: MapboxNavigationView, value: CoordinateRecord?) in
        view.origin = value.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
      }
      Prop("destination") { (view: MapboxNavigationView, value: CoordinateRecord?) in
        view.setDestination(value.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) })
      }
      Prop("waypoints") { (view: MapboxNavigationView, value: [CoordinateRecord]?) in
        view.waypoints = (value ?? []).map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
      }
      Prop("profile") { (view: MapboxNavigationView, value: String?) in view.profile = value ?? "driving-traffic" }
      Prop("language") { (view: MapboxNavigationView, value: String?) in view.setLanguage(value) }
      Prop("units") { (view: MapboxNavigationView, value: String?) in view.units = value }
      Prop("simulate") { (view: MapboxNavigationView, value: Bool?) in view.simulate = value ?? false }
      Prop("simulationSpeed") { (_: MapboxNavigationView, _: Double?) in /* not supported on iOS */ }
      Prop("muted") { (view: MapboxNavigationView, value: Bool?) in view.setMuted(value ?? false) }

      Prop("mapStyle") { (view: MapboxNavigationView, value: String?) in view.setMapStyle(value) }
      Prop("theme") { (view: MapboxNavigationView, value: String?) in view.setTheme(value) }
      Prop("vehicle") { (view: MapboxNavigationView, value: String?) in view.setVehicle(value) }
      Prop("vehicleScale") { (view: MapboxNavigationView, value: Double?) in view.setVehicleScale(value) }
      Prop("vehicleRotation") { (view: MapboxNavigationView, value: Double?) in view.setVehicleRotation(value) }

      Prop("showsUserLocation") { (view: MapboxNavigationView, value: Bool?) in
        view.setShowsUserLocation(value ?? true)
      }
      Prop("showDestinationPin") { (view: MapboxNavigationView, value: Bool?) in
        view.setShowDestinationPin(value ?? true)
      }
      Prop("zoomEnabled") { (view: MapboxNavigationView, value: Bool?) in view.setZoomEnabled(value ?? true) }
      Prop("scrollEnabled") { (view: MapboxNavigationView, value: Bool?) in view.setScrollEnabled(value ?? true) }
      Prop("rotateEnabled") { (view: MapboxNavigationView, value: Bool?) in view.setRotateEnabled(value ?? true) }
      Prop("pitchEnabled") { (view: MapboxNavigationView, value: Bool?) in view.setPitchEnabled(value ?? true) }

      // Mapbox's own banner / speed sign are Android-only; the JS UI (NavigationUI) is used on both platforms.
      Prop("showManeuverBanner") { (_: MapboxNavigationView, _: Bool?) in }
      Prop("showSpeedLimit") { (_: MapboxNavigationView, _: Bool?) in }
      Prop("topInset") { (_: MapboxNavigationView, _: Double?) in }
      Prop("speedLimitBottomMargin") { (_: MapboxNavigationView, _: Double?) in }

      Prop("camera") { (view: MapboxNavigationView, value: CameraRecord?) in view.applyCamera(value) }
      Prop("markers") { (view: MapboxNavigationView, value: [MarkerRecord]?) in view.setMarkers(value ?? []) }
      Prop("markerImages") { (view: MapboxNavigationView, value: [String: String]?) in
        view.setMarkerImages(value ?? [:])
      }

      AsyncFunction("fetchRoute") { (view: MapboxNavigationView) in view.fetchRoute(startAfter: false) }
      AsyncFunction("startNavigation") { (view: MapboxNavigationView) in view.startNavigation() }
      AsyncFunction("stopNavigation") { (view: MapboxNavigationView) in view.stopNavigation() }
      AsyncFunction("recenter") { (view: MapboxNavigationView) in view.recenter() }
      AsyncFunction("showOverview") { (view: MapboxNavigationView) in view.showOverview() }
      AsyncFunction("setCamera") { (view: MapboxNavigationView, camera: CameraRecord) in view.applyCamera(camera) }
    }
  }
}
