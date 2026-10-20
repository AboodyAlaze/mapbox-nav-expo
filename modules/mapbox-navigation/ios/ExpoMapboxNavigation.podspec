require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoMapboxNavigation'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'FS'
  s.homepage       = 'https://github.com/mapbox/mapbox-navigation-ios'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/mapbox/mapbox-navigation-ios.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '*.{h,m,mm,swift}'

  # 3D FS vehicles used as the location puck
  s.resource_bundles = {
    'MapboxNavigationModels' => ['models/*.glb']
  }

  # Mapbox Navigation SDK v3 (Core + Maps) comes from Swift Package Manager.
  # `spm_dependency` is provided by React Native (>= 0.75) inside the Podfile.
  spm_dependency(s,
    url: 'https://github.com/mapbox/mapbox-navigation-ios.git',
    # 3.26.0 is the newest release whose dependencies (Maps 11.26.0, NavigationNative 324.26.0, Turf 4.0.0)
    # are all published on GitHub. Newer tags (3.27+) need Maps tags that are not public.
    requirement: { kind: 'exactVersion', version: '3.26.0' },
    products: ['MapboxNavigationCore']
  )
end
