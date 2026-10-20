# mapbox-nav-expo

Demo app + the **`expo-mapbox-nav`** module: Mapbox Navigation SDK v3 for Expo (Android + iOS) with turn-by-turn navigation,
pressable SVG markers, `<Camera/>`, dark mode and a 3D vehicle puck.

- The module lives in [`modules/mapbox-navigation`](modules/mapbox-navigation) (full English docs in its README).
- The root is an Expo SDK 58 demo app that uses it.

```bash
npm install
MAPBOX_ACCESS_TOKEN=pk.xxxxx npx expo prebuild --clean   # public token, never commit it
npx expo run:ios --device     # or: npx expo run:android --device
```

> Development build only (no Expo Go). iOS Navigation SDK is pinned to 3.26.0, Android to 3.33.0. The Arabic notes below describe the same project in more detail.

---

# Mapbox Navigation SDK ← Expo (SDK 58)

مشروع Expo كامل يربط **Mapbox Navigation SDK for Android (v3)** مع React Native عن طريق **Expo Modules API**.

```
mapbox-nav-expo/
├─ App.tsx                          ← تطبيق تجريبي (خريطة + تعليمات الانعطاف + ETA + أزرار)
├─ app.json                         ← حط الـ Token هنا
└─ modules/mapbox-navigation/       ← الـ Expo Module (محلي، يتربط تلقائياً Autolinking)
   ├─ android/ …                    ← Kotlin: MapView + Navigation SDK + Route line + Camera + Voice
   ├─ app.plugin.js                 ← Config plugin (يكتب الـ Token + الصلاحيات بالـ AndroidManifest)
   └─ src/ + index.ts               ← واجهة TypeScript
```

## iOS (جديد)
الموديول يدعم **iOS و Android** بنفس الـ API (Mapbox Navigation SDK for iOS **v3.26.0**، مضاف عن طريق Swift Package Manager).
```bash
npm install
npx expo prebuild --clean          # يولّد android/ و ios/
npx expo run:ios --device          # يحتاج Xcode 16+ (و iOS 16.4+ على الجهاز)
```
- **ليش 3.26.0؟** آخر نسخة تعتمد على حزم (Maps 11.26.0 و NavigationNative 324.26.0) كلها منشورة بـ GitHub. النسخ الأحدث (3.27+) تحتاج Maps tags مو متوفرة، فيعلق الـ build عند "Planning build".
- التوكن العام (pk.) يُكتب تلقائياً بـ `Info.plist` (`MBXAccessToken`). ما يحتاج Secret token لنسخ الـ stable.
- `expo-build-properties` مضبوط على `useFrameworks: "dynamic"` (توصية React Native لاعتماد Swift Packages).
- الموديلات 3D (السيارة/الدراجة) بـ `ios/models/*.glb`.
- **كراش `dyld: Library not loaded: MapboxCommon.framework`**: مكتبات Mapbox الثنائية ديناميكية وتجي من SPM فما تنحط بالتطبيق لحالها. الـ config plugin يضيف مرحلة بناء (`Embed Mapbox frameworks`) تنسخها وتوقّعها داخل `Frameworks/` تلقائياً. بعد تحديث الـ plugin لازم `npx expo prebuild --clean`.
- **كراش `must include "audio" in UIBackgroundModes`**: الـ SDK يشترط وضع `audio` بالـ Info.plist لتعليمات الصوت. الـ plugin يضيفه تلقائياً (وخيار `"backgroundLocation": true` بإعدادات الـ plugin يضيف `location` لو تريد الملاحة تكمل والشاشة مقفلة).
- ملاحظات iOS: `simulationSpeed` غير مدعوم، وضغطة الخريطة (`onMapPress`) ترجع الإحداثيات فقط (بدون اسم المكان).
- لو ظهرت أخطاء Swift بعد أول بناء الصقها لي (ما أكدر أبني iOS من عندي).

## واجهة الملاحة (نفس التصميم على الطرفين)
الـ UI مرسوم بـ React Native (`NavigationTopBanner`, `SpeedLimitSign` (MAX), `RoadNamePill`, `NavigationBottomBar`, `ManeuverIcon`…)
مثل تصميم Mapbox بالصورة، فيطلع **مطابق 100%** على iOS و Android، ويظهر فقط بعد ما تضغط **Directions**.
البيانات من `onProgress`: `instruction, stepDistanceRemaining, maneuverType/Modifier, roadName, speedLimit, durationRemaining, distanceRemaining`.

## Markers قابلة للضغط
```tsx
<Marker id={s.id} coordinate={{ latitude, longitude }} iconKey="store" onPress={() => open(s)}>
  <Svg …/>
</Marker>
```
الضغط على الـ marker يشغّل `onPress` (يعتمد على الـ marker نفسه، مو على ضغطة الخريطة). بالتطبيق: ضغطة marker ← sheet فيه **Directions** ← الملاحة.

## التشغيل (3 خطوات)

1. افتح `app.json` وحط الـ **Public Token** (يبدأ بـ `pk.`) بخانة `accessToken` (فارغة افتراضياً):
   ```json
   ["./modules/mapbox-navigation/app.plugin.js", { "accessToken": "pk.xxxxx" }]
   ```
   (أو بدون تعديل الملف: `MAPBOX_ACCESS_TOKEN=pk.xxx npx expo run:android`)

2. ```bash
   npm install
   ```

3. وصّل موبايل Android (أو Emulator) وشغّل:
   ```bash
   npx expo run:android
   ```
   يحتاج Android Studio (Android SDK 37) + JDK 17 أو أحدث.
   **ما يشتغل داخل Expo Go** لأنه Native Module — لازم Development Build.

## كيف تجرب بدون ما تسوق؟
التطبيق يشتغل افتراضياً بوضع **Simulate driving** (مسار تجريبي ببغداد: ساحة التحرير ← مطار بغداد):
اضغط **Preview route** لمعاينة المسار، بعدها **Start** وراح تشوف الأيقونة تمشي، التعليمات تتغير، والصوت يشتغل.
لو تريد GPS حقيقي: طفّي Simulate، وخلي خانة Origin فارغة.

## الاستخدام بالكود

```tsx
import { MapboxNavigationView, type MapboxNavigationViewRef } from './modules/mapbox-navigation';

const ref = useRef<MapboxNavigationViewRef>(null);

<MapboxNavigationView
  ref={ref}
  style={{ flex: 1 }}
  destination={{ latitude: 33.2625, longitude: 44.2346 }}
  // origin={{ latitude, longitude }}   // إذا ما انحط يستخدم GPS
  profile="driving-traffic"             // driving | walking | cycling
  language="ar"
  simulate={false}
  muted={false}
  onRouteReady={(e) => console.log(e.distance, e.duration)}
  onProgress={(p) => console.log(p.instruction, p.stepDistanceRemaining)}
  onArrival={(e) => e.final && console.log('وصلنا')}
/>

ref.current?.fetchRoute();       // معاينة المسار
ref.current?.startNavigation();  // بدء الملاحة
ref.current?.stopNavigation();
ref.current?.recenter();
ref.current?.showOverview();
```

Props: `mapStyle ('navigation'|'streets'|'outdoors'|'satellite'), theme ('system'|'light'|'dark'), units, styleURL, origin, destination, waypoints, profile, language, simulate, simulationSpeed, muted, showManeuverBanner, showSpeedLimit, topInset, speedLimitBottomMargin`

- **Dark Mode**: `theme="system"` (default) يتبع وضع التلفون تلقائياً، أو افرضه `light` / `dark`. الخريطة ولافتات Mapbox تتبدل مع بعض.
- **لافتات Mapbox الرسمية**: شريط الانعطاف (أيقونات الانعطاف والـ lanes) ولافتة حد السرعة (MUTCD/Vienna حسب البلد) من مكتبة `ui-components` مال Mapbox.
  تتحكم بمكانها بـ `topInset` و `speedLimitBottomMargin`.
- ضغطة طويلة على الخريطة ترسل `onMapLongPress` (التطبيق التجريبي يستخدمها لتحديد الوجهة).
Events: `onMapPress, onMapLongPress, onReady, onLocation, onRouteReady, onRouteError, onNavigationStarted, onNavigationStopped, onProgress, onOffRoute, onArrival, onCameraModeChanged, onError`

## Camera (مثل `@rnmapbox/maps`)

```tsx
import { MapboxNavigationView, Camera } from './modules/mapbox-navigation';

<MapboxNavigationView style={{ flex: 1 }}>
  <Camera
    zoomLevel={13}
    centerCoordinate={[userLocation.longitude, userLocation.latitude]}   // [lng, lat]
    animationMode="flyTo"        // flyTo | easeTo | linearTo | moveTo (فوري) | none
    animationDuration={1000}
    // pitch={45} heading={90} minZoomLevel={3} maxZoomLevel={19}
  />
</MapboxNavigationView>

// أو من الـ ref:
ref.current?.setCamera({ zoomLevel: 15, centerCoordinate: [lng, lat], animationMode: 'flyTo', animationDuration: 800 });
```
الكاميرا تنطبق كل ما تتغير قيمة من قيمها. وإذا فعّلت `<Camera>` ما يسوي المركز التلقائي على موقعك أول مرة.
أثناء الملاحة طلب الكاميرا يوقف التتبع التلقائي، وزر ◎ (`recenter()`) يرجعه.

## كيف تجرب كل شي
افتح ⚙ بالتطبيق: قسم **MAP PROPS** فيه سويچات `showsUserLocation / zoomEnabled / scrollEnabled / rotateEnabled / pitchEnabled / zoomControlEnabled`،
وقسم **CAMERA** يشغّل `<Camera/>` ويتحكم بـ zoomLevel و pitch و heading و animationMode و animationDuration، مع زر "Fly to my location" وزر `ref.setCamera()`.
حجم المركبة 1–100 (أزرار −5 −1 +1 +5).

## مثل react-native-maps

```tsx
import Svg, { Path } from 'react-native-svg';
import { MapboxNavigationView, Marker } from './modules/mapbox-navigation';

<MapboxNavigationView
  style={{ flex: 1 }}
  showsUserLocation
  zoomEnabled={false}
  zoomControlEnabled={false}   // موجود للتوافق فقط (Mapbox ما عنده أزرار zoom)
  scrollEnabled={false}
  rotateEnabled={false}
  pitchEnabled={false}
>
  {items.map((item) => (
    <Marker
      key={item.id}
      coordinate={{ latitude: item.Location.latitude, longitude: item.Location.longitude }}
      iconKey="shop"            // كل الـ markers بنفس الـ iconKey تشترك بصورة وحدة = سريعة
      onPress={() => open(item)}
    >
      <Svg width={34} height={44}>…</Svg>
    </Marker>
  ))}
</MapboxNavigationView>
```
**الأداء:** الـ SVG يتحول لصورة **مرة وحدة لكل iconKey** (offscreen)، وتنرسم كل الـ markers على الـ GPU داخل الخريطة
(طبقة واحدة، مو View لكل marker). التحديث diff: يضيف/يحرك/يحذف الـ markers المتغيرة بس. إذا ما حطيت `iconKey` يصير لكل marker صورة خاصة.
- الـ marker يظهر بعد لحظة قصيرة من أول render (وقت التحويل لصورة).
- لتغيير شكل الـ SVG لنفس الـ marker غيّر `iconKey`.

## الواجهة الحالية
- الخريطة تفتح **Streets** بشكل طبيعي (حركة حرة، بدون ملاحة).
- اضغط على أي مكان/محل → يطلع **Bottom Sheet** فيه الاسم والتصنيف والعنوان والمسافة، وزر **Directions** يبدأ الملاحة مباشرة.
- ⚙ للإعدادات: نمط الخريطة، Dark Mode، نوع المركبة (سيارة / دراجة نارية) وحجمها.
- المركبة على الخريطة موديل **3D** عليه شعار FS (`android/src/main/assets/models/fs_car.glb` و `fs_bike.glb`):
  السيارة بيضاء، ودراجة التوصيل صندوقها أبيض عليه الشعار. تولدهم من `models/make_models.py` إذا تريد تغيّر الألوان/الشعار.
  إذا ظهرت المركبة معكوسة اضغط **Flip direction**، وإذا صغيرة/كبيرة غيّر **Size**.

## ملاحظات مهمة

- **نسخة الـ SDK**: `3.33.0` (آخر إصدار مستقر مذكور بالـ CHANGELOG داخل الـ zip). تتغير من
  `modules/mapbox-navigation/android/build.gradle` أو عن طريق `-PmapboxNavigationVersion=x.y.z`.
  الـ zip نفسه هو كود المصدر (3.35-SNAPSHOT) — المشروع يسحب الـ SDK الجاهز من Maven مو يبنيه من المصدر.
- **إذا طلع خطأ 401/403 بالـ Gradle** عند تحميل الـ SDK: سوّ Secret Token من حسابك بصلاحية `DOWNLOADS:READ`
  (يبدأ بـ `sk.`) وحطه بـ `~/.gradle/gradle.properties`:
  ```
  MAPBOX_DOWNLOADS_TOKEN=sk.xxxxx
  ```
  (الـ build.gradle يستخدمه تلقائياً إذا موجود.)
- الـ Token العام (`pk.`) هو الوحيد المطلوب بالتطبيق. لا تحط الـ `sk.` داخل التطبيق.
- Android فقط (الـ zip الي رفعته Android SDK). ما في iOS.
- الملاحة الحقيقية تشغّل Foreground Service + إشعار، والـ SDK يحسب تكلفة (Trips/MAU) حسب تسعير Mapbox.
- إذا رتبت واجهة RN فوق الخريطة، ممكن تحتاج تعدّل padding الكاميرا بـ `MapboxNavigationView.kt`
  (`followingPadding` / `overviewPadding`).
