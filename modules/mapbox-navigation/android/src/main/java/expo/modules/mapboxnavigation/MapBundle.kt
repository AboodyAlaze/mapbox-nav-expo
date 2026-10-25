package expo.modules.mapboxnavigation

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import com.mapbox.geojson.Point
import com.mapbox.maps.MapInitOptions
import com.mapbox.maps.MapLoadedCallback
import com.mapbox.maps.MapView
import com.mapbox.maps.plugin.animation.CameraAnimationsLifecycleListener
import com.mapbox.maps.plugin.animation.CameraAnimatorType
import com.mapbox.maps.plugin.animation.camera
import com.mapbox.maps.plugin.annotation.annotations
import com.mapbox.maps.plugin.annotation.generated.OnPointAnnotationClickListener
import com.mapbox.maps.plugin.annotation.generated.PointAnnotation
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationManager
import com.mapbox.maps.plugin.annotation.generated.createPointAnnotationManager
import com.mapbox.maps.plugin.gestures.OnMapClickListener
import com.mapbox.maps.plugin.gestures.OnMapLongClickListener
import com.mapbox.maps.plugin.gestures.gestures
import com.mapbox.maps.plugin.locationcomponent.LocationConsumer
import com.mapbox.maps.plugin.locationcomponent.LocationProvider
import com.mapbox.maps.plugin.locationcomponent.location
import com.mapbox.maps.plugin.scalebar.scalebar
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The map's own lifecycle.
 *
 * Maps SDK 11 follows the lifecycle of the screen that hosts it (here: the react-native-screens Fragment). When a screen
 * is covered by another one, its Fragment view is destroyed and the map is destroyed with it: after coming back the
 * map stays BLACK. Giving the map a private owner that is destroyed only when the map is really released fixes that for
 * every screen, and it is also what lets one map move from one screen to another (shared element) without being rebuilt.
 */
internal class HolderLifecycleOwner : LifecycleOwner {
  private val registry = LifecycleRegistry(this)
  override val lifecycle: Lifecycle get() = registry

  init {
    registry.currentState = Lifecycle.State.RESUMED
  }

  fun destroy() {
    registry.currentState = Lifecycle.State.DESTROYED
  }
}

/** The vehicle puck follows positions pushed from JS (snapped to the route while navigating). */
internal class ExternalLocationProvider : LocationProvider {
  private val consumers = CopyOnWriteArraySet<LocationConsumer>()
  private var lastPoint: Point? = null
  private var lastBearing: Double? = null

  override fun registerLocationConsumer(locationConsumer: LocationConsumer) {
    if (consumers.add(locationConsumer)) {
      lastPoint?.let { p ->
        locationConsumer.onLocationUpdated(p, options = { duration = 0 })
        lastBearing?.let { b -> locationConsumer.onBearingUpdated(b, options = { duration = 0 }) }
      }
    }
  }

  override fun unRegisterLocationConsumer(locationConsumer: LocationConsumer) {
    consumers.remove(locationConsumer)
  }

  fun update(point: Point, bearing: Double?, durationMs: Long) {
    lastPoint = point
    if (bearing != null) lastBearing = bearing
    consumers.forEach { consumer ->
      consumer.onLocationUpdated(point, options = {
        duration = durationMs
        interpolator = LinearInterpolator()
      })
      if (bearing != null) {
        consumer.onBearingUpdated(bearing, options = {
          duration = durationMs
          interpolator = LinearInterpolator()
        })
      }
    }
  }
}

/**
 * ONE native map plus everything that is tied to it (puck provider, annotation managers, decoded marker pictures).
 * Several React views (hosts) can use the same bundle (`sharedKey`): the MapView is simply moved into the container of
 * the newest host, already loaded and rendered, so nothing is created again. When that host goes away the map goes back
 * to the previous one. Every host re-applies its own props after it receives the map.
 */
internal class MapBundle(val key: String, context: Context) {
  val lifecycleOwner = HolderLifecycleOwner()
  val locationProvider = ExternalLocationProvider()

  // TextureView (not SurfaceView): it can be clipped with rounded corners and survives being moved between parents.
  val mapView: MapView = MapView(context, MapInitOptions(context, textureView = true))

  val hosts = mutableListOf<MapboxNavigationView>()
  var host: MapboxNavigationView? = null
    private set
  var loadedStyleUri: String? = null

  /** The map has drawn a complete frame at least once (style + tiles). */
  var mapLoaded = false
    private set

  var pinManager: PointAnnotationManager? = null
  var markerManager: PointAnnotationManager? = null
  val markerBitmaps = mutableMapOf<String, Bitmap>()
  val markerAnnotations = mutableMapOf<String, PointAnnotation>()
  val markerSignatures = mutableMapOf<String, String>()
  val annotationToMarker = mutableMapOf<String, String>()

  private var destroyed = false

  private companion object {
    const val TAG = "ExpoMapboxNav"
  }

  init {
    mapView.scalebar.enabled = false
    mapView.mapboxMap.subscribeMapLoaded(MapLoadedCallback {
      mapLoaded = true
      host?.onMapLoadedEvent()
    })
    mapView.location.apply {
      setLocationProvider(locationProvider)
      puckBearingEnabled = true
      enabled = true
    }

    // any camera movement not started by us (finger gestures, flyTo…) leaves "following" mode
    mapView.camera.addCameraAnimationsLifecycleListener(object : CameraAnimationsLifecycleListener {
      override fun onAnimatorStarting(type: CameraAnimatorType, animator: ValueAnimator, owner: String?) {
        host?.onCameraAnimationStarted(owner)
      }

      override fun onAnimatorEnding(type: CameraAnimatorType, animator: ValueAnimator, owner: String?) {}

      override fun onAnimatorCancelling(type: CameraAnimatorType, animator: ValueAnimator, owner: String?) {}

      override fun onAnimatorInterrupting(
        type: CameraAnimatorType,
        runningAnimator: ValueAnimator,
        runningAnimatorOwner: String?,
        newAnimator: ValueAnimator,
        newAnimatorOwner: String?,
      ) {}
    })

    mapView.gestures.addOnMapClickListener(OnMapClickListener { point ->
      host?.onMapTapped(point)
      false
    })
    mapView.gestures.addOnMapLongClickListener(OnMapLongClickListener { point ->
      host?.onMapLongTapped(point)
      true
    })

    pinManager = mapView.annotations.createPointAnnotationManager()
    markerManager = mapView.annotations.createPointAnnotationManager().also { manager ->
      manager.addClickListener(OnPointAnnotationClickListener { annotation ->
        host?.onAnnotationClicked(annotation.id)
        true
      })
    }
  }

  /**
   * Takes the MapView out of its current parent. An Android view can keep its parent when it is removed while a view
   * transition is running (react-native-screens / Fragments do that), and adding it somewhere else then crashes with
   * "The specified child already has a parent". Ending the transition first clears it.
   * @return false when the map could not be freed (the caller must not move it).
   */
  private fun detachMapView(): Boolean {
    repeat(3) {
      val parent = mapView.parent ?: return true
      val group = parent as? ViewGroup
      if (group == null) {
        Log.w(TAG, "the map has a parent that is not a ViewGroup: ${parent.javaClass.name}")
        return false
      }
      group.endViewTransition(mapView)
      group.removeView(mapView)
      if (mapView.parent == null) return true
      group.endViewTransition(mapView)
      if (mapView.parent == null) return true
    }
    val stuck = mapView.parent
    if (stuck != null) Log.w(TAG, "the map still has a parent after removeView: ${stuck.javaClass.name}")
    return stuck == null
  }

  /**
   * The newest host owns the map: it moves into that host's container and the host re-applies its props.
   * @return false when the map could not be moved: the host then builds a private map instead (no crash).
   */
  fun attach(newHost: MapboxNavigationView): Boolean {
    if (destroyed) return false
    if (host === newHost && mapView.parent === newHost.container) {
      if (!hosts.contains(newHost)) hosts.add(newHost)
      return true
    }
    val old = host
    if (!detachMapView()) return false

    // the owner must be in place BEFORE the MapView is attached: the Maps SDK looks for it when it attaches
    newHost.container.setViewTreeLifecycleOwner(lifecycleOwner)
    try {
      newHost.container.addView(
        mapView,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      )
    } catch (t: Throwable) {
      Log.w(TAG, "could not move the map into the new view: ${t.message}")
      // put it back where it was, so the previous view is not left without its map
      runCatching {
        (mapView.parent as? ViewGroup)?.removeView(mapView)
        old?.container?.addView(
          mapView,
          FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
      }
      return false
    }

    if (!hosts.contains(newHost)) hosts.add(newHost)
    host = newHost
    old?.onMapTakenAway()
    newHost.onMapAdopted()
    return true
  }

  /** A host was removed from React: the map goes back to the previous host, or is destroyed with the last one. */
  fun release(leaving: MapboxNavigationView) {
    hosts.remove(leaving)
    if (host === leaving) {
      host = null
      detachMapView()
      val next = hosts.lastOrNull()
      if (next == null) {
        destroy()
      } else {
        // not in the middle of React's unmount work: let it finish first
        mapView.post {
          if (!destroyed && host == null && !attach(next)) next.useOwnMap()
        }
      }
    } else if (hosts.isEmpty()) {
      destroy()
    }
  }

  private fun destroy() {
    if (destroyed) return
    destroyed = true
    SharedMaps.forget(key)
    lifecycleOwner.destroy() // the Maps lifecycle plugin destroys the MapView when the owner is destroyed
    runCatching { mapView.onDestroy() }
  }
}

/** Maps that share a `sharedKey` (main thread only). Without a key every view gets a private map. */
internal object SharedMaps {
  private val bundles = mutableMapOf<String, MapBundle>()

  fun acquire(key: String, context: Context): MapBundle = bundles.getOrPut(key) { MapBundle(key, context) }

  fun forget(key: String) {
    bundles.remove(key)
  }
}
