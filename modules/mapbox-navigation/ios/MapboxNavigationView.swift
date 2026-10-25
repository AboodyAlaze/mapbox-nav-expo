import Combine
import CoreLocation
import ExpoModulesCore
import MapboxCommon
@_spi(Experimental) import MapboxMaps
import UIKit

/// The map. Everything navigation-related (routes, banners, voice, rerouting, arrival) runs in TypeScript;
/// this view only draws: tiles, the vehicle puck (position pushed from JS), the route line, markers and the camera.
final class MapboxNavigationView: ExpoView {
  // ---------------------------------------------------------------- events
  let onReady = EventDispatcher()
  let onMapLoaded = EventDispatcher()
  let onCameraModeChanged = EventDispatcher()
  let onError = EventDispatcher()
  let onMapPress = EventDispatcher()
  let onMapLongPress = EventDispatcher()
  let onMarkerPress = EventDispatcher()

  // ---------------------------------------------------------------- props
  private var explicitStyleUri: String?
  private var mapStyle = "streets"
  private var theme = "system"
  private var vehicle = "car"
  private var vehicleScale: Double = 8
  private var vehicleRotation: Double = 0
  private var showsUserLocation = true
  private var showDestinationPin = true
  private var zoomEnabled = true
  private var scrollEnabled = true
  private var rotateEnabled = true
  private var pitchEnabled = true
  private var destination: CLLocationCoordinate2D?

  // ---------------------------------------------------------------- state
  // The native map lives in a MapBundle: created when this view gets a window, or RECEIVED (already loaded) when another
  // view with the same `sharedKey` already has one. Before that, `bundle` is nil and the props are only remembered.
  private var bundle: MapBundle?
  private var sharedKey: String?
  private lazy var privateKey = "private:\(ObjectIdentifier(self).hashValue)"
  private var mapView: MapView! { bundle?.mapView }
  private var loadedStyleUri: String? {
    get { bundle?.loadedStyleUri }
    set { bundle?.loadedStyleUri = newValue }
  }
  private var cameraSpec: CameraRecord?
  private var pendingImages: [String: String] = [:]
  private var currentNight = false
  private var nativeMode = "idle"
  private var cameraControlledByJs = false

  // route line (re-applied after every style load)
  private var routeGeoJson: String?
  private var routeGradient: String?
  private var alternativesGeoJson: String?
  private var routeTrim: Double = 0

  // markers
  private var markerManager: PointAnnotationManager? { bundle?.markerManager }
  private var pinManager: PointAnnotationManager? { bundle?.pinManager }
  private var markerSpecs: [MarkerRecord] = []
  private var markerImages: [String: UIImage] {
    get { bundle?.markerImages ?? [:] }
    set { bundle?.markerImages = newValue }
  }
  private var markerAnnotations: [String: PointAnnotation] {
    get { bundle?.markerAnnotations ?? [:] }
    set { bundle?.markerAnnotations = newValue }
  }
  private var markerSignatures: [String: String] {
    get { bundle?.markerSignatures ?? [:] }
    set { bundle?.markerSignatures = newValue }
  }
  private var pinImage: UIImage?

  private static let routeSource = "fs-route-src"
  private static let altSource = "fs-alt-src"
  private static let routeLine = "fs-route-line"
  private static let routeCasing = "fs-route-casing"
  private static let altLine = "fs-alt-line"

  // MARK: - init

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = UIColor(white: 0.93, alpha: 1)
    MapboxTokenHelper.applyIfNeeded()
    currentNight = resolveNight()
  }

  /// The map is created (or received, when it is shared) only now: every prop, `sharedKey` included, is already here.
  /// Only the FIRST window takes it: later ones (a covered screen shown again) never steal a map that moved on.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil, bundle == nil else { return }
    let b = SharedMaps.acquire(key: sharedKey ?? privateKey, styleUri: resolveStyleUri(night: currentNight))
    bundle = b
    b.attach(self)
  }

  /// Removed from React (not just covered by another screen): the map goes back to the previous host.
  override func willMove(toSuperview newSuperview: UIView?) {
    super.willMove(toSuperview: newSuperview)
    if newSuperview == nil, let b = bundle {
      bundle = nil
      b.release(self)
    }
  }

  /// Views with the same key share ONE native map (shared element: nothing is created again).
  func setSharedKey(_ value: String?) {
    sharedKey = (value?.isEmpty ?? true) ? nil : value
  }

  // MARK: - called by the MapBundle

  /// This view just received the map: push every prop of THIS view into it.
  func onMapAdopted() {
    currentNight = resolveNight()
    decodePendingImages()
    applyStyle()
    applyPuck()
    applyGestures()
    installGestureRecognizers()
    // the tap handlers of the pins point at the view that created them: build them again for this view
    markerAnnotations = [:]
    markerSignatures = [:]
    markerManager?.annotations = []
    updateDestinationPin()
    syncMarkers()
    applyRoute()
    if let spec = cameraSpec { applyCamera(spec) }
    onReady(["ready": true])
    if bundle?.mapLoaded == true { emitMapLoaded() }
  }

  /// The map finished loading (style + tiles): lets JS swap a placeholder picture for the live map.
  func emitMapLoaded() {
    onMapLoaded(["loaded": true])
  }

  func onMapTakenAway() {
    nativeMode = "idle"
    removeGestureRecognizers()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if let mapView, mapView.superview === self { mapView.frame = bounds }
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    refreshTheme()
  }

  // MARK: - commands from JS

  /// A picture of the map as it is drawn right now (markers included), saved in the temp folder. Done by the Maps SDK
  /// itself: a GPU surface cannot be photographed with the normal view tools. Resolves with a `file://` uri.
  func takeSnapshot(_ promise: Promise) {
    guard bundle != nil, let mapView else {
      promise.reject("NO_MAP", "The map is not ready yet")
      return
    }
    do {
      let image = try mapView.snapshot()
      // JPEG: a map picture is opaque and a PNG of it is several times bigger, so it loads and decodes much slower
      guard let data = image.jpegData(compressionQuality: 0.88) else {
        promise.reject("SNAPSHOT_FAILED", "Could not encode the picture")
        return
      }
      let name = "mapbox-nav-snapshot-\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
      try data.write(to: url)
      promise.resolve(url.absoluteString)
    } catch {
      promise.reject("SNAPSHOT_FAILED", error.localizedDescription)
    }
  }

  func updateLocation(lat: Double, lng: Double, bearing: Double, accuracy: Double) {
    let clLocation = CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
      altitude: 0,
      horizontalAccuracy: max(1, accuracy),
      verticalAccuracy: -1,
      course: bearing >= 0 ? bearing : -1,
      speed: -1,
      timestamp: Date()
    )
    bundle?.locationSubject.send([Location(clLocation: clLocation)])
  }

  func followCamera(lat: Double, lng: Double, bearing: Double, zoom: Double, pitch: Double, durationMs: Double) {
    guard bundle != nil else { return }
    nativeMode = "following"
    let padTop = pitch > 0 ? bounds.height * 0.34 : 0
    mapView.camera.ease(
      to: CameraOptions(
        center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
        padding: UIEdgeInsets(top: padTop, left: 0, bottom: 0, right: 0),
        zoom: CGFloat(zoom),
        bearing: bearing,
        pitch: CGFloat(pitch)
      ),
      duration: max(0, durationMs / 1000.0)
    )
  }

  func fitCamera(_ points: [[Double]], top: Double, right: Double, bottom: Double, left: Double, durationMs: Double) {
    let coordinates = points.compactMap { p -> CLLocationCoordinate2D? in
      p.count >= 2 ? CLLocationCoordinate2D(latitude: p[1], longitude: p[0]) : nil
    }
    guard bundle != nil, coordinates.count >= 2 else { return }
    nativeMode = "overview"
    do {
      let camera = try mapView.mapboxMap.camera(
        for: coordinates,
        camera: CameraOptions(bearing: 0, pitch: 0),
        coordinatesPadding: UIEdgeInsets(top: top, left: left, bottom: bottom, right: right),
        maxZoom: nil,
        offset: nil
      )
      mapView.camera.ease(to: camera, duration: max(0, durationMs / 1000.0))
    } catch {
      onError(["code": "FIT_FAILED", "message": error.localizedDescription])
    }
  }

  // MARK: - route line (JSON based, so it works with any style)

  func setRoute(geoJson: String, gradient: String) {
    routeGeoJson = geoJson
    routeGradient = gradient
    routeTrim = 0
    applyRoute()
    updateDestinationPin()
  }

  func setAlternatives(geoJson: String) {
    alternativesGeoJson = geoJson
    applyRoute()
  }

  func setRouteProgress(_ fraction: Double) {
    routeTrim = min(1, max(0, fraction))
    guard bundle != nil else { return }
    let map: MapboxMap = mapView.mapboxMap
    guard map.isStyleLoaded else { return }
    for id in [Self.routeLine, Self.routeCasing] where map.layerExists(withId: id) {
      try? map.setLayerProperty(for: id, property: "line-trim-offset", value: [0.0, routeTrim])
    }
  }

  func clearRoute() {
    routeGeoJson = nil
    routeGradient = nil
    alternativesGeoJson = nil
    routeTrim = 0
    removeRouteLayers()
    updateDestinationPin()
  }

  private func removeRouteLayers() {
    guard bundle != nil else { return }
    let map: MapboxMap = mapView.mapboxMap
    guard map.isStyleLoaded else { return }
    for id in [Self.routeLine, Self.routeCasing, Self.altLine] where map.layerExists(withId: id) {
      try? map.removeLayer(withId: id)
    }
    for id in [Self.routeSource, Self.altSource] where map.sourceExists(withId: id) {
      try? map.removeSource(withId: id)
    }
  }

  private func jsonObject(_ string: String) -> Any? {
    try? JSONSerialization.jsonObject(with: Data(string.utf8), options: [.fragmentsAllowed])
  }

  /// Idempotent: (re)creates sources and layers from the last route data. Called again after a style change.
  func applyRoute() {
    guard bundle != nil else { return }
    let map: MapboxMap = mapView.mapboxMap
    guard map.isStyleLoaded else { return }
    guard let geo = routeGeoJson, let geoObject = jsonObject(geo) else {
      removeRouteLayers()
      return
    }

    do {
      // main route (lineMetrics is required for line-gradient / line-trim-offset)
      if map.sourceExists(withId: Self.routeSource) {
        try map.setSourceProperty(for: Self.routeSource, property: "data", value: geoObject)
      } else {
        try map.addSource(
          withId: Self.routeSource,
          properties: ["type": "geojson", "lineMetrics": true, "maxzoom": 16, "data": geoObject]
        )
      }

      // alternatives
      if let alt = alternativesGeoJson, let altObject = jsonObject(alt) {
        if map.sourceExists(withId: Self.altSource) {
          try map.setSourceProperty(for: Self.altSource, property: "data", value: altObject)
        } else {
          try map.addSource(withId: Self.altSource, properties: ["type": "geojson", "data": altObject])
        }
      }

      // the route goes under the road labels (and so under the puck, which is on top of everything)
      let below = ["road-label-navigation", "road-label"].first { map.layerExists(withId: $0) }
      let position: LayerPosition? = below.map { .below($0) }

      let width: [Any] = ["interpolate", ["exponential", 1.5], ["zoom"], 8, 3, 12, 7, 16, 13, 19, 24]
      let casingWidth: [Any] = ["interpolate", ["exponential", 1.5], ["zoom"], 8, 5, 12, 10, 16, 19, 19, 32]
      let layout: [String: Any] = ["line-cap": "round", "line-join": "round"]

      if !map.layerExists(withId: Self.altLine), alternativesGeoJson != nil {
        try map.addLayer(
          with: [
            "id": Self.altLine, "type": "line", "source": Self.altSource, "layout": layout,
            "paint": ["line-color": "#9AA4B2", "line-opacity": 0.9, "line-width": width] as [String: Any],
          ],
          layerPosition: position
        )
      }
      if !map.layerExists(withId: Self.routeCasing) {
        try map.addLayer(
          with: [
            "id": Self.routeCasing, "type": "line", "source": Self.routeSource, "layout": layout,
            "paint": [
              "line-color": "#FFFFFF", "line-opacity": 0.95, "line-width": casingWidth,
              "line-trim-offset": [0.0, routeTrim],
            ] as [String: Any],
          ],
          layerPosition: position
        )
      }
      if !map.layerExists(withId: Self.routeLine) {
        try map.addLayer(
          with: [
            "id": Self.routeLine, "type": "line", "source": Self.routeSource, "layout": layout,
            "paint": ["line-width": width, "line-trim-offset": [0.0, routeTrim]] as [String: Any],
          ],
          layerPosition: position
        )
      }
      if let gradient = routeGradient, let expression = jsonObject(gradient) {
        try map.setLayerProperty(for: Self.routeLine, property: "line-gradient", value: expression)
      }

      // 3D models (the FS vehicle) are drawn in their own pass, so the lines would be painted over them.
      // Same fix as the official SDK: let 3D objects occlude the route line.
      for id in [Self.altLine, Self.routeCasing, Self.routeLine] where map.layerExists(withId: id) {
        try? map.setLayerProperty(for: id, property: "line-depth-occlusion-factor", value: 1.0)
      }
    } catch {
      onError(["code": "ROUTE_LINE_FAILED", "message": error.localizedDescription])
    }
  }

  // MARK: - camera (<Camera/>, like @rnmapbox/maps)

  func applyCamera(_ spec: CameraRecord?) {
    guard let spec else { return }
    cameraSpec = spec // re-applied whenever this view receives the (shared) map
    cameraControlledByJs = true
    guard bundle != nil else { return }

    if spec.minZoomLevel != nil || spec.maxZoomLevel != nil {
      try? mapView.mapboxMap.setCameraBounds(
        with: CameraBoundsOptions(
          maxZoom: spec.maxZoomLevel.map { CGFloat($0) },
          minZoom: spec.minZoomLevel.map { CGFloat($0) }
        )
      )
    }

    var center: CLLocationCoordinate2D?
    if let c = spec.centerCoordinate, c.count >= 2 {
      center = CLLocationCoordinate2D(latitude: c[1], longitude: c[0])
    }
    if center == nil, spec.zoomLevel == nil, spec.pitch == nil, spec.heading == nil { return }

    emitMode("idle")

    let options = CameraOptions(
      center: center,
      zoom: spec.zoomLevel.map { CGFloat($0) },
      bearing: spec.heading,
      pitch: spec.pitch.map { CGFloat($0) }
    )
    let duration = max(0, (spec.animationDuration ?? 1000) / 1000.0)
    switch spec.animationMode {
    case "flyTo":
      mapView.camera.fly(to: options, duration: duration)
    case "easeTo", "linearTo":
      mapView.camera.ease(to: options, duration: duration)
    default:
      mapView.mapboxMap.setCamera(to: options)
    }
  }

  private func emitMode(_ mode: String) {
    if nativeMode == mode { return }
    nativeMode = mode
    onCameraModeChanged(["mode": mode])
  }

  // MARK: - prop setters

  func setStyleUri(_ value: String?) {
    explicitStyleUri = (value?.isEmpty ?? true) ? nil : value
    applyStyle()
  }

  func setMapStyle(_ value: String?) {
    mapStyle = value ?? "streets"
    applyStyle()
  }

  func setTheme(_ value: String?) {
    theme = value ?? "system"
    refreshTheme()
  }

  func setVehicle(_ value: String?) {
    vehicle = value ?? "car"
    applyPuck()
  }

  func setVehicleScale(_ value: Double?) {
    vehicleScale = min(100, max(1, value ?? 8))
    applyPuck()
  }

  func setVehicleRotation(_ value: Double?) {
    vehicleRotation = value ?? 0
    applyPuck()
  }

  func setShowsUserLocation(_ value: Bool) {
    showsUserLocation = value
    applyPuck()
  }

  func setShowDestinationPin(_ value: Bool) {
    showDestinationPin = value
    updateDestinationPin()
  }

  func setDestination(_ value: CLLocationCoordinate2D?) {
    destination = value
    updateDestinationPin()
  }

  func setZoomEnabled(_ value: Bool) { zoomEnabled = value; applyGestures() }
  func setScrollEnabled(_ value: Bool) { scrollEnabled = value; applyGestures() }
  func setRotateEnabled(_ value: Bool) { rotateEnabled = value; applyGestures() }
  func setPitchEnabled(_ value: Bool) { pitchEnabled = value; applyGestures() }

  // MARK: - theme / style

  private func resolveNight() -> Bool {
    switch theme {
    case "dark": return true
    case "light": return false
    default: return traitCollection.userInterfaceStyle == .dark
    }
  }

  private func resolveStyleUri(night: Bool) -> String {
    if let explicitStyleUri { return explicitStyleUri }
    switch mapStyle {
    case "streets":
      return night ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/streets-v12"
    case "outdoors":
      return "mapbox://styles/mapbox/outdoors-v12"
    case "satellite":
      return "mapbox://styles/mapbox/satellite-streets-v12"
    default:
      return night ? "mapbox://styles/mapbox/navigation-night-v1" : "mapbox://styles/mapbox/navigation-day-v1"
    }
  }

  private func applyStyle() {
    guard let mapView else { return }
    let uri = resolveStyleUri(night: currentNight)
    if uri == loadedStyleUri { return }
    loadedStyleUri = uri
    if let styleURI = StyleURI(rawValue: uri) {
      mapView.mapboxMap.loadStyle(styleURI)
    }
  }

  private func refreshTheme() {
    guard mapView != nil else { return }
    let night = resolveNight()
    if night != currentNight { currentNight = night }
    applyStyle()
  }

  // MARK: - vehicle puck (3D FS models)

  private func modelURL(_ name: String) -> URL? {
    let bundle = Bundle(for: MapboxNavigationView.self)
    if let url = bundle.url(forResource: name, withExtension: "glb") { return url }
    if let resourceBundleURL = bundle.url(forResource: "MapboxNavigationModels", withExtension: "bundle"),
       let resourceBundle = Bundle(url: resourceBundleURL),
       let url = resourceBundle.url(forResource: name, withExtension: "glb")
    {
      return url
    }
    return Bundle.main.url(forResource: name, withExtension: "glb")
  }

  private func applyPuck() {
    guard let mapView else { return }
    var options = mapView.location.options
    options.puckBearing = .course
    options.puckBearingEnabled = true

    guard showsUserLocation else {
      options.puckType = nil
      mapView.location.options = options
      return
    }

    let modelName: String?
    switch vehicle {
    case "car": modelName = "fs_car"
    case "bike": modelName = "fs_bike"
    default: modelName = nil
    }

    if let modelName, let url = modelURL(modelName) {
      options.puckType = .puck3D(
        Puck3DConfiguration(
          model: Model(uri: url),
          modelScale: .constant([vehicleScale, vehicleScale, vehicleScale]),
          modelRotation: .constant([0, 0, vehicleRotation]),
          modelOpacity: .constant(1),
          modelCastShadows: .constant(false),
          modelReceiveShadows: .constant(false),
          modelScaleMode: .constant(.map),
          modelEmissiveStrength: .constant(0)
        )
      )
    } else {
      options.puckType = .puck2D(Puck2DConfiguration.makeDefault(showBearing: true))
    }
    mapView.location.options = options
  }

  // MARK: - gestures (react-native-maps style props)

  /// Uses the UIKit recognizers of the map so it does not depend on Maps SDK option names.
  private func applyGestures() {
    guard let mapView else { return }
    for recognizer in mapView.gestureRecognizers ?? [] {
      if recognizer is UIPinchGestureRecognizer {
        recognizer.isEnabled = zoomEnabled
      } else if recognizer is UIRotationGestureRecognizer {
        recognizer.isEnabled = rotateEnabled
      } else if let pan = recognizer as? UIPanGestureRecognizer {
        pan.isEnabled = pan.minimumNumberOfTouches >= 2 ? pitchEnabled : scrollEnabled
      } else if let tap = recognizer as? UITapGestureRecognizer, tap.name != "fs.mapPress" {
        if tap.numberOfTapsRequired >= 2 || tap.numberOfTouchesRequired >= 2 {
          tap.isEnabled = zoomEnabled
        }
      } else if let press = recognizer as? UILongPressGestureRecognizer, press.name != "fs.mapLongPress" {
        press.isEnabled = zoomEnabled // quick zoom
      }
    }
  }

  /// Our own recognizers (they never cancel the map's): taps, long press and "the user moved the map".
  private func installGestureRecognizers() {
    let tap = UITapGestureRecognizer(target: self, action: #selector(handleMapTap(_:)))
    tap.name = "fs.mapPress"
    tap.cancelsTouchesInView = false
    tap.delegate = self
    mapView.addGestureRecognizer(tap)

    let press = UILongPressGestureRecognizer(target: self, action: #selector(handleMapLongPress(_:)))
    press.name = "fs.mapLongPress"
    press.cancelsTouchesInView = false
    press.delegate = self
    mapView.addGestureRecognizer(press)

    let pan = UIPanGestureRecognizer(target: self, action: #selector(handleUserMove(_:)))
    pan.name = "fs.userPan"
    pan.cancelsTouchesInView = false
    pan.delegate = self
    mapView.addGestureRecognizer(pan)

    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handleUserMove(_:)))
    pinch.name = "fs.userPinch"
    pinch.cancelsTouchesInView = false
    pinch.delegate = self
    mapView.addGestureRecognizer(pinch)

    let rotation = UIRotationGestureRecognizer(target: self, action: #selector(handleUserMove(_:)))
    rotation.name = "fs.userRotate"
    rotation.cancelsTouchesInView = false
    rotation.delegate = self
    mapView.addGestureRecognizer(rotation)
  }

  private func removeGestureRecognizers() {
    guard let mapView else { return }
    for recognizer in mapView.gestureRecognizers ?? [] where (recognizer.name ?? "").hasPrefix("fs.") {
      mapView.removeGestureRecognizer(recognizer)
    }
  }

  @objc private func handleUserMove(_ recognizer: UIGestureRecognizer) {
    if recognizer.state == .began { emitMode("idle") }
  }

  // MARK: - map taps

  @objc private func handleMapTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    let coordinate = mapView.mapboxMap.coordinate(for: recognizer.location(in: mapView))
    onMapPress(["latitude": coordinate.latitude, "longitude": coordinate.longitude])
  }

  @objc private func handleMapLongPress(_ recognizer: UILongPressGestureRecognizer) {
    guard recognizer.state == .began else { return }
    let coordinate = mapView.mapboxMap.coordinate(for: recognizer.location(in: mapView))
    onMapLongPress(["latitude": coordinate.latitude, "longitude": coordinate.longitude])
  }

  // MARK: - markers (<Marker/>)

  func setMarkers(_ value: [MarkerRecord]) {
    markerSpecs = value
    syncMarkers()
  }

  /// icon key -> base64 PNG (captured from the SVG children in JS, once per key)
  func setMarkerImages(_ value: [String: String]) {
    pendingImages = value
    guard bundle != nil else { return }
    decodePendingImages()
    syncMarkers()
  }

  /// The decoded pictures are shared by every view that uses the same map: a second view never decodes them again.
  private func decodePendingImages() {
    guard let bundle else { return }
    for (key, base64) in pendingImages where bundle.markerImages[key] == nil && !base64.isEmpty {
      if let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
         let image = UIImage(data: data, scale: UIScreen.main.scale)
      {
        bundle.markerImages[key] = image
      }
    }
  }

  private func iconAnchor(x: Double, y: Double) -> IconAnchor {
    let h = x < 0.33 ? 0 : (x > 0.66 ? 2 : 1)
    let v = y < 0.33 ? 0 : (y > 0.66 ? 2 : 1)
    switch (v, h) {
    case (0, 0): return .topLeft
    case (0, 2): return .topRight
    case (0, _): return .top
    case (2, 0): return .bottomLeft
    case (2, 2): return .bottomRight
    case (2, _): return .bottom
    case (_, 0): return .left
    case (_, 2): return .right
    default: return .center
    }
  }

  /// Diff-based: only touches the annotations that changed; every marker is drawn by the map (GPU), no views.
  private func syncMarkers() {
    guard let manager = markerManager else { return }

    var wanted: [String: MarkerRecord] = [:]
    for spec in markerSpecs where markerImages[spec.icon] != nil {
      wanted[spec.id] = spec
    }

    for (id, _) in markerAnnotations {
      guard let spec = wanted[id] else {
        markerAnnotations[id] = nil
        markerSignatures[id] = nil
        continue
      }
      let signature = "\(spec.icon)|\(iconAnchor(x: spec.anchorX, y: spec.anchorY))"
      if markerSignatures[id] != signature {
        markerAnnotations[id] = nil
        markerSignatures[id] = nil
      }
    }

    for (id, spec) in wanted {
      let coordinate = CLLocationCoordinate2D(latitude: spec.latitude, longitude: spec.longitude)
      if var existing = markerAnnotations[id] {
        existing.point = Point(coordinate)
        markerAnnotations[id] = existing
        continue
      }
      guard let image = markerImages[spec.icon] else { continue }
      var annotation = PointAnnotation(coordinate: coordinate)
      annotation.image = .init(image: image, name: spec.icon)
      annotation.iconAnchor = iconAnchor(x: spec.anchorX, y: spec.anchorY)
      annotation.tapHandler = { [weak self] _ in
        self?.onMarkerPress(["id": id])
        return true
      }
      markerAnnotations[id] = annotation
      markerSignatures[id] = "\(spec.icon)|\(iconAnchor(x: spec.anchorX, y: spec.anchorY))"
    }

    manager.annotations = Array(markerAnnotations.values)
  }

  // MARK: - destination pin

  private func makePinImage() -> UIImage {
    let size = CGSize(width: 34, height: 46)
    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { _ in
      let red = UIColor(red: 0.898, green: 0.282, blue: 0.302, alpha: 1)
      red.setFill()
      let radius = size.width / 2
      let path = UIBezierPath()
      path.move(to: CGPoint(x: radius - radius * 0.62, y: radius * 1.45))
      path.addLine(to: CGPoint(x: radius, y: size.height))
      path.addLine(to: CGPoint(x: radius + radius * 0.62, y: radius * 1.45))
      path.close()
      path.fill()
      UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: size.width, height: size.width)).fill()
      UIColor.white.setFill()
      UIBezierPath(
        ovalIn: CGRect(x: radius - radius * 0.4, y: radius - radius * 0.4, width: radius * 0.8, height: radius * 0.8)
      ).fill()
    }
  }

  private func updateDestinationPin() {
    guard let manager = pinManager else { return }
    guard showDestinationPin, let destination, routeGeoJson == nil else {
      manager.annotations = []
      return
    }
    let image = pinImage ?? makePinImage()
    pinImage = image
    var annotation = PointAnnotation(coordinate: destination)
    annotation.image = .init(image: image, name: "fs-destination-pin")
    annotation.iconAnchor = .bottom
    manager.annotations = [annotation]
  }
}

extension MapboxNavigationView: UIGestureRecognizerDelegate {
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    true
  }
}
