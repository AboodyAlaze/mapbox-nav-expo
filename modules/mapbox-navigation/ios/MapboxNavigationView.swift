import Combine
import CoreLocation
import ExpoModulesCore
import MapboxCommon
import MapboxDirections
@_spi(Experimental) import MapboxMaps
import MapboxNavigationCore
import UIKit

// MARK: - Shared navigation core (MapboxNavigationProvider must exist only ONCE per process)

@MainActor
enum NavigationCore {
  private static var _provider: MapboxNavigationProvider?

  static func provider(locale: Locale) -> MapboxNavigationProvider {
    if let existing = _provider { return existing }
    MapboxTokenHelper.applyIfNeeded()
    let token = MapboxOptions.accessToken
    let credentials = token.isEmpty ? NavigationCoreApiConfiguration() : NavigationCoreApiConfiguration(accessToken: token)
    let config = CoreConfig(credentials: credentials, locationSource: .live, locale: locale)
    let provider = MapboxNavigationProvider(coreConfig: config)
    _provider = provider
    return provider
  }

  static func setLocationSource(_ source: LocationSource) {
    guard let provider = _provider else { return }
    var config = provider.coreConfig
    if config.locationSource == source { return }
    config.locationSource = source
    provider.apply(coreConfig: config)
  }

  static func setLocale(_ locale: Locale) {
    guard let provider = _provider else { return }
    var config = provider.coreConfig
    config.locale = locale
    provider.apply(coreConfig: config)
  }
}

// MARK: - View

/// Map + Mapbox Navigation SDK v3 for iOS.
/// Mirrors the Android implementation: same props, same events, same view commands.
final class MapboxNavigationView: ExpoView {
  // ---------------------------------------------------------------- events
  let onReady = EventDispatcher()
  let onLocation = EventDispatcher()
  let onRouteReady = EventDispatcher()
  let onRouteError = EventDispatcher()
  let onNavigationStarted = EventDispatcher()
  let onNavigationStopped = EventDispatcher()
  let onProgress = EventDispatcher()
  let onOffRoute = EventDispatcher()
  let onArrival = EventDispatcher()
  let onCameraModeChanged = EventDispatcher()
  let onError = EventDispatcher()
  let onMapPress = EventDispatcher()
  let onMapLongPress = EventDispatcher()
  let onMarkerPress = EventDispatcher()

  // ---------------------------------------------------------------- props
  var origin: CLLocationCoordinate2D?
  var destination: CLLocationCoordinate2D?
  var waypoints: [CLLocationCoordinate2D] = []
  var profile: String = "driving-traffic"
  var units: String?
  var simulate = false

  private var explicitStyleUri: String?
  private var mapStyle = "streets"
  private var theme = "system"
  private var language = Locale.current.languageCode ?? "en"
  private var muted = false
  private var vehicle = "car"
  private var vehicleScale: Double = 8
  private var vehicleRotation: Double = 0
  private var showsUserLocation = true
  private var showDestinationPin = true
  private var zoomEnabled = true
  private var scrollEnabled = true
  private var rotateEnabled = true
  private var pitchEnabled = true

  // ---------------------------------------------------------------- state
  private var navigationMapView: NavigationMapView?
  private var provider: MapboxNavigationProvider?
  private var cancellables = Set<AnyCancellable>()
  private var isSetUp = false
  private var isNavigating = false
  private var pendingStart = false
  private var firstLocationReceived = false
  private var cameraControlledByJs = false
  private var lastLocation: CLLocation?
  private var previewRoutes: NavigationRoutes?
  private var routeTask: Task<Void, Never>?
  private var loadedStyleUri: String?
  private var currentNight = false

  // last known live data (merged into the progress event)
  private var lastRoadName: String?
  private var lastSpeedLimit: Double?
  private var lastSpeedUnit = "km/h"
  private var lastCurrentSpeed: Double?

  // markers
  private var markerManager: PointAnnotationManager?
  private var pinManager: PointAnnotationManager?
  private var markerSpecs: [MarkerRecord] = []
  private var markerImages: [String: UIImage] = [:]
  private var markerAnnotations: [String: PointAnnotation] = [:]
  private var markerSignatures: [String: String] = [:]
  private var pinImage: UIImage?

  // MARK: - init

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = UIColor(white: 0.93, alpha: 1)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, !isSetUp {
      setUp()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    navigationMapView?.frame = bounds
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    refreshTheme()
  }

  // MARK: - set up

  private func setUp() {
    isSetUp = true
    MapboxTokenHelper.applyIfNeeded()

    let provider = NavigationCore.provider(locale: Locale(identifier: language))
    self.provider = provider
    let nav = provider.mapboxNavigation

    let mapView = NavigationMapView(
      location: nav.navigation().locationMatching.map(\.enhancedLocation).eraseToAnyPublisher(),
      routeProgress: nav.navigation().routeProgress.map { $0?.routeProgress }.eraseToAnyPublisher(),
      routeRefreshing: nav.navigation().routeRefreshing.eraseToAnyPublisher(),
      heading: nav.navigation().heading,
      predictiveCacheManager: provider.predictiveCacheManager
    )
    mapView.frame = bounds
    mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    mapView.viewportPadding = UIEdgeInsets(top: 200, left: 40, bottom: 160, right: 40)
    addSubview(mapView)
    navigationMapView = mapView

    // natural map first: no automatic following
    mapView.navigationCamera.update(cameraState: .idle)

    currentNight = resolveNight()
    applyStyle()
    applyPuck()
    applyGestures()
    installTapRecognizers()

    markerManager = mapView.mapView.annotations.makePointAnnotationManager()
    pinManager = mapView.mapView.annotations.makePointAnnotationManager()
    syncMarkers()
    updateDestinationPin()

    observe(nav)

    // voice guidance
    provider.routeVoiceController.speechSynthesizer.muted = muted

    // free drive → puck + location events before navigation starts
    nav.tripSession().startFreeDrive()

    onReady(["ready": true])
  }

  // MARK: - observers

  private func observe(_ nav: MapboxNavigation) {
    // location
    nav.navigation().locationMatching
      .receive(on: DispatchQueue.main)
      .sink { [weak self] state in self?.handleLocation(state) }
      .store(in: &cancellables)

    // progress
    nav.navigation().routeProgress
      .receive(on: DispatchQueue.main)
      .sink { [weak self] state in
        guard let progress = state?.routeProgress else { return }
        self?.handleProgress(progress)
      }
      .store(in: &cancellables)

    // arrival
    nav.navigation().waypointsArrival
      .receive(on: DispatchQueue.main)
      .sink { [weak self] status in
        guard let self else { return }
        if status.event is WaypointArrivalStatus.Events.ToFinalDestination {
          self.onArrival(["final": true])
        } else if status.event is WaypointArrivalStatus.Events.ToWaypoint {
          self.onArrival(["final": false])
        }
      }
      .store(in: &cancellables)

    // rerouting → off-route flag
    nav.navigation().rerouting
      .receive(on: DispatchQueue.main)
      .sink { [weak self] status in
        guard let self else { return }
        self.onOffRoute(["offRoute": status.event is ReroutingStatus.Events.FetchingRoute])
      }
      .store(in: &cancellables)

    // camera mode
    navigationMapView?.navigationCamera.cameraStates
      .receive(on: DispatchQueue.main)
      .sink { [weak self] state in
        let mode: String
        switch state {
        case .following: mode = "following"
        case .overview: mode = "overview"
        default: mode = "idle"
        }
        self?.onCameraModeChanged(["mode": mode])
      }
      .store(in: &cancellables)
  }

  private func handleLocation(_ state: MapMatchingState) {
    let location = state.enhancedLocation
    lastLocation = location

    if !firstLocationReceived {
      firstLocationReceived = true
      if !cameraControlledByJs {
        navigationMapView?.mapView.mapboxMap.setCamera(
          to: CameraOptions(center: location.coordinate, zoom: 15, bearing: 0, pitch: 0)
        )
      }
    }

    // posted limit / current speed (expressed in the unit of the posted limit, mph or km/h)
    lastRoadName = state.roadName?.text
    if let limit = state.speedLimit.value {
      let useMph = limit.unit == UnitSpeed.milesPerHour
      let unit: UnitSpeed = useMph ? .milesPerHour : .kilometersPerHour
      lastSpeedLimit = limit.converted(to: unit).value.rounded()
      lastSpeedUnit = useMph ? "mph" : "km/h"
      lastCurrentSpeed = state.currentSpeed.converted(to: unit).value.rounded()
    } else {
      lastSpeedLimit = nil
      lastCurrentSpeed = state.currentSpeed.converted(to: .kilometersPerHour).value.rounded()
      lastSpeedUnit = "km/h"
    }

    var payload: [String: Any] = [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "speed": max(0, location.speed),
    ]
    if location.course >= 0 { payload["bearing"] = location.course }
    onLocation(payload)
  }

  private func handleProgress(_ progress: RouteProgress) {
    let step = progress.currentLegProgress.currentStepProgress
    var payload: [String: Any] = [
      "distanceRemaining": progress.distanceRemaining,
      "durationRemaining": progress.durationRemaining,
      "fractionTraveled": progress.fractionTraveled,
      "stepDistanceRemaining": step.distanceRemaining,
    ]

    if let banner = step.currentVisualInstruction {
      if let text = banner.primaryInstruction.text { payload["instruction"] = text }
      if let secondary = banner.secondaryInstruction?.text { payload["secondaryInstruction"] = secondary }
      if let type = banner.primaryInstruction.maneuverType { payload["maneuverType"] = type.rawValue }
      if let direction = banner.primaryInstruction.maneuverDirection { payload["maneuverModifier"] = direction.rawValue }
    }

    if let name = progress.currentLegProgress.currentStep.names?.first, !name.isEmpty {
      payload["roadName"] = name
    } else if let name = lastRoadName, !name.isEmpty {
      payload["roadName"] = name
    }

    if let limit = lastSpeedLimit { payload["speedLimit"] = limit }
    payload["speedUnit"] = lastSpeedUnit
    if let speed = lastCurrentSpeed { payload["currentSpeed"] = speed }

    onProgress(payload)
  }

  // MARK: - commands (called from JS)

  func fetchRoute(startAfter: Bool) {
    guard let provider else { return emitError("NOT_READY", "Navigation is not ready yet") }
    guard let destination else { return emitRouteError("NO_DESTINATION", "destination prop is required") }
    guard let start = origin ?? lastLocation?.coordinate else {
      return emitRouteError("NO_ORIGIN", "Waiting for a GPS fix – pass `origin` or try again in a moment")
    }

    let coordinates = [start] + waypoints + [destination]
    let locale = Locale(identifier: language)
    let options = NavigationRouteOptions(
      waypoints: coordinates.map { Waypoint(coordinate: $0) },
      profileIdentifier: profileIdentifier(),
      queryItems: nil,
      locale: locale,
      distanceUnit: units == "imperial" ? .mile : .kilometer
    )

    routeTask?.cancel()
    pendingStart = startAfter
    let task = provider.mapboxNavigation.routingProvider().calculateRoutes(options: options)
    routeTask = Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        let routes = try await task.value
        if Task.isCancelled { return }
        self.previewRoutes = routes
        self.onRouteReady([
          "distance": routes.mainRoute.route.distance,
          "duration": routes.mainRoute.route.expectedTravelTime,
          "routeCount": 1 + routes.alternativeRoutes.count,
        ])
        self.updateDestinationPin()
        if self.pendingStart {
          self.pendingStart = false
          self.beginNavigation(routes)
        } else {
          self.navigationMapView?.showcase(routes, animated: true)
        }
      } catch {
        self.pendingStart = false
        self.emitRouteError("ROUTE_REQUEST_FAILED", error.localizedDescription)
      }
    }
  }

  func startNavigation() {
    guard provider != nil else { return emitError("NOT_READY", "Navigation is not ready yet") }
    if isNavigating { return }
    if let routes = previewRoutes {
      beginNavigation(routes)
    } else {
      fetchRoute(startAfter: true)
    }
  }

  private func beginNavigation(_ routes: NavigationRoutes) {
    guard let provider else { return }
    isNavigating = true
    cameraControlledByJs = false

    NavigationCore.setLocationSource(simulate ? .simulation(initialLocation: nil) : .live)
    provider.routeVoiceController.speechSynthesizer.muted = muted
    provider.mapboxNavigation.tripSession().startActiveGuidance(with: routes, startLegIndex: 0)
    navigationMapView?.navigationCamera.update(cameraState: .following)
    updateDestinationPin()
    onNavigationStarted(["simulated": simulate])
  }

  func stopNavigation() {
    guard let provider else { return }
    let wasNavigating = isNavigating
    isNavigating = false
    pendingStart = false
    routeTask?.cancel()
    previewRoutes = nil

    navigationMapView?.removeRoutes()
    NavigationCore.setLocationSource(.live)
    provider.mapboxNavigation.tripSession().startFreeDrive()
    updateDestinationPin()
    recenter()
    if wasNavigating { onNavigationStopped(["reason": "stopped"]) }
  }

  func recenter() {
    guard let navigationMapView else { return }
    if isNavigating {
      navigationMapView.navigationCamera.update(cameraState: .following)
      return
    }
    guard let location = lastLocation else { return }
    navigationMapView.navigationCamera.update(cameraState: .idle)
    navigationMapView.mapView.camera.fly(
      to: CameraOptions(center: location.coordinate, zoom: 15, bearing: 0, pitch: 0),
      duration: 0.9
    )
  }

  func showOverview() {
    guard let navigationMapView else { return }
    if isNavigating {
      navigationMapView.navigationCamera.update(cameraState: .overview)
    } else if let routes = previewRoutes {
      navigationMapView.showcase(routes, animated: true)
    }
  }

  // MARK: - camera (<Camera/>, like @rnmapbox/maps)

  func applyCamera(_ spec: CameraRecord?) {
    guard let spec, let navigationMapView else { return }
    cameraControlledByJs = true
    let mapView = navigationMapView.mapView

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

    // an explicit camera request wins over the automatic navigation camera
    navigationMapView.navigationCamera.update(cameraState: .idle)

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

  func setLanguage(_ value: String?) {
    let newLanguage = (value?.isEmpty ?? true) ? (Locale.current.languageCode ?? "en") : value!
    if newLanguage == language { return }
    language = newLanguage
    if isSetUp { NavigationCore.setLocale(Locale(identifier: language)) }
  }

  func setMuted(_ value: Bool) {
    muted = value
    provider?.routeVoiceController.speechSynthesizer.muted = value
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

  func setZoomEnabled(_ value: Bool) { zoomEnabled = value; applyGestures() }
  func setScrollEnabled(_ value: Bool) { scrollEnabled = value; applyGestures() }
  func setRotateEnabled(_ value: Bool) { rotateEnabled = value; applyGestures() }
  func setPitchEnabled(_ value: Bool) { pitchEnabled = value; applyGestures() }

  func setDestination(_ value: CLLocationCoordinate2D?) {
    destination = value
    previewRoutes = nil // a new destination invalidates the previewed route
    updateDestinationPin()
  }

  // MARK: - theme / style

  private func systemNight() -> Bool {
    traitCollection.userInterfaceStyle == .dark
  }

  private func resolveNight() -> Bool {
    switch theme {
    case "dark": return true
    case "light": return false
    default: return systemNight()
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
    guard let mapView = navigationMapView?.mapView else { return }
    let uri = resolveStyleUri(night: currentNight)
    if uri == loadedStyleUri { return }
    loadedStyleUri = uri
    if let styleURI = StyleURI(rawValue: uri) {
      mapView.mapboxMap.loadStyle(styleURI)
    }
  }

  private func refreshTheme() {
    guard isSetUp else { return }
    let night = resolveNight()
    if night != currentNight {
      currentNight = night
    }
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
    guard let navigationMapView else { return }
    guard showsUserLocation else {
      navigationMapView.puckType = nil
      return
    }

    let modelName: String?
    switch vehicle {
    case "car": modelName = "fs_car"
    case "bike": modelName = "fs_bike"
    default: modelName = nil
    }

    if let modelName, let url = modelURL(modelName) {
      let configuration = Puck3DConfiguration(
        model: Model(uri: url),
        modelScale: .constant([vehicleScale, vehicleScale, vehicleScale]),
        modelRotation: .constant([0, 0, vehicleRotation]),
        modelOpacity: .constant(1),
        modelCastShadows: .constant(false),
        modelReceiveShadows: .constant(false),
        modelScaleMode: .constant(.map),
        modelEmissiveStrength: .constant(0)
      )
      navigationMapView.puckType = .puck3D(configuration)
    } else {
      navigationMapView.puckType = .puck2D(.navigationDefault)
    }
    navigationMapView.puckBearing = .course
  }

  // MARK: - gestures (react-native-maps style props)

  /// Uses the UIKit recognizers of the map so it does not depend on Maps SDK option names.
  private func applyGestures() {
    guard let mapView = navigationMapView?.mapView else { return }
    for recognizer in mapView.gestureRecognizers ?? [] {
      if recognizer is UIPinchGestureRecognizer {
        recognizer.isEnabled = zoomEnabled
      } else if recognizer is UIRotationGestureRecognizer {
        recognizer.isEnabled = rotateEnabled
      } else if let pan = recognizer as? UIPanGestureRecognizer {
        if pan.minimumNumberOfTouches >= 2 {
          pan.isEnabled = pitchEnabled
        } else {
          pan.isEnabled = scrollEnabled
        }
      } else if let tap = recognizer as? UITapGestureRecognizer, tap.name != "fs.mapPress" {
        if tap.numberOfTapsRequired >= 2 || tap.numberOfTouchesRequired >= 2 {
          tap.isEnabled = zoomEnabled
        }
      } else if let press = recognizer as? UILongPressGestureRecognizer, press.name != "fs.mapLongPress" {
        press.isEnabled = zoomEnabled // quick zoom
      }
    }
  }

  // MARK: - map taps

  private func installTapRecognizers() {
    guard let mapView = navigationMapView?.mapView else { return }
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
  }

  @objc private func handleMapTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended, let mapView = navigationMapView?.mapView else { return }
    let coordinate = mapView.mapboxMap.coordinate(for: recognizer.location(in: mapView))
    onMapPress(["latitude": coordinate.latitude, "longitude": coordinate.longitude])
  }

  @objc private func handleMapLongPress(_ recognizer: UILongPressGestureRecognizer) {
    guard recognizer.state == .began, let mapView = navigationMapView?.mapView else { return }
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
    var images: [String: UIImage] = [:]
    for (key, base64) in value {
      if let existing = markerImages[key] {
        images[key] = existing
        continue
      }
      if !base64.isEmpty,
         let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
         let image = UIImage(data: data, scale: UIScreen.main.scale)
      {
        images[key] = image
      }
    }
    markerImages = images
    syncMarkers()
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

    // remove disappeared / changed-icon markers
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

    // move existing / create new
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
    guard showDestinationPin, let destination, previewRoutes == nil, !isNavigating else {
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

  // MARK: - helpers

  private func profileIdentifier() -> ProfileIdentifier {
    switch profile {
    case "driving": return .automobile
    case "walking": return .walking
    case "cycling": return .cycling
    default: return .automobileAvoidingTraffic
    }
  }

  private func emitError(_ code: String, _ message: String) {
    onError(["code": code, "message": message])
  }

  private func emitRouteError(_ code: String, _ message: String) {
    onRouteError(["code": code, "message": message])
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
