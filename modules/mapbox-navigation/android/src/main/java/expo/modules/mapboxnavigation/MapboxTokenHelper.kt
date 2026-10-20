package expo.modules.mapboxnavigation

import android.content.Context
import android.content.pm.PackageManager
import com.mapbox.common.MapboxOptions

/**
 * Resolves the Mapbox PUBLIC access token (pk.…).
 *
 * Priority:
 *  1. a token already set at runtime (MapboxNavigation.setAccessToken(...) from JS)
 *  2. <meta-data android:name="com.mapbox.navigation.expo.ACCESS_TOKEN"> written by the config plugin
 */
object MapboxTokenHelper {
  const val META_KEY = "com.mapbox.navigation.expo.ACCESS_TOKEN"

  fun applyIfNeeded(context: Context) {
    val current = runCatching { MapboxOptions.accessToken }.getOrDefault("")
    if (current.isNotBlank()) return

    val token = readFromManifest(context)
    if (!token.isNullOrBlank()) {
      MapboxOptions.accessToken = token
    }
  }

  private fun readFromManifest(context: Context): String? {
    return try {
      val appInfo = context.packageManager.getApplicationInfo(
        context.packageName,
        PackageManager.GET_META_DATA
      )
      appInfo.metaData?.getString(META_KEY)
    } catch (_: Throwable) {
      null
    }
  }

  fun hasToken(): Boolean =
    runCatching { MapboxOptions.accessToken }.getOrDefault("").isNotBlank()
}
