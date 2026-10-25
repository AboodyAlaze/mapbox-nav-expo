import Combine
import CoreLocation
import MapboxCommon
@_spi(Experimental) import MapboxMaps
import UIKit

final class WeakHost {
  weak var value: MapboxNavigationView?
  init(_ value: MapboxNavigationView) { self.value = value }
}

/// ONE native map plus everything tied to it (puck positions, annotation managers, decoded marker pictures).
/// Several React views (hosts) can use the same bundle (`sharedKey`): the MapView is simply moved into the newest host,
/// already loaded and rendered, so nothing is created again. When that host goes away the map goes back to the previous
/// one. Every host re-applies its own props after it receives the map.
final class MapBundle {
  let key: String
  let mapView: MapView
  let locationSubject = PassthroughSubject<[Location], Never>()
  var loadedStyleUri: String?
  /// The map has drawn a complete frame at least once (style + tiles).
  private(set) var mapLoaded = false
  var markerManager: PointAnnotationManager?
  var pinManager: PointAnnotationManager?
  var markerImages: [String: UIImage] = [:]
  var markerAnnotations: [String: PointAnnotation] = [:]
  var markerSignatures: [String: String] = [:]

  private var cancelables = Set<AnyCancelable>()
  private var hosts: [WeakHost] = []
  private(set) weak var host: MapboxNavigationView?

  init(key: String, styleUri: String) {
    self.key = key
    loadedStyleUri = styleUri

    // the puck follows the positions pushed from JS (snapped to the route while navigating)
    let model = LocationDataModel(location: locationSubject.eraseToAnyPublisher(), heading: nil)
    let initOptions = MapInitOptions(styleURI: StyleURI(rawValue: styleUri), locationDataModel: model)
    let map = MapView(frame: .zero, mapInitOptions: initOptions)
    map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    mapView = map

    map.mapboxMap.onStyleLoaded.observe { [weak self] _ in
      self?.host?.applyRoute()
    }.store(in: &cancelables)

    map.mapboxMap.onMapLoaded.observeNext { [weak self] _ in
      self?.mapLoaded = true
      self?.host?.emitMapLoaded()
    }.store(in: &cancelables)

    markerManager = map.annotations.makePointAnnotationManager()
    pinManager = map.annotations.makePointAnnotationManager()
  }

  /// The newest host owns the map: it moves into that host and the host re-applies its props.
  func attach(_ newHost: MapboxNavigationView) {
    hosts.removeAll { $0.value == nil }
    if !hosts.contains(where: { $0.value === newHost }) { hosts.append(WeakHost(newHost)) }
    if host === newHost && mapView.superview === newHost { return }

    let old = host
    host = newHost
    old?.onMapTakenAway()

    mapView.removeFromSuperview()
    mapView.frame = newHost.bounds
    newHost.addSubview(mapView)
    newHost.onMapAdopted()
  }

  /// A host was removed from React: the map goes back to the previous host, or is released with the last one.
  func release(_ leaving: MapboxNavigationView) {
    hosts.removeAll { $0.value == nil || $0.value === leaving }
    if host === leaving {
      host = nil
      mapView.removeFromSuperview()
      if let next = hosts.compactMap({ $0.value }).last {
        attach(next)
      } else {
        SharedMaps.forget(key)
      }
    } else if hosts.isEmpty {
      SharedMaps.forget(key)
    }
  }
}

/// Maps that share a `sharedKey` (main thread only). Without a key every view gets a private map.
enum SharedMaps {
  private static var bundles: [String: MapBundle] = [:]

  static func acquire(key: String, styleUri: String) -> MapBundle {
    if let existing = bundles[key] { return existing }
    let bundle = MapBundle(key: key, styleUri: styleUri)
    bundles[key] = bundle
    return bundle
  }

  static func forget(_ key: String) {
    bundles[key] = nil
  }
}
