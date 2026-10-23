require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoMapboxNavigation'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'FS'
  s.homepage       = 'https://github.com/AboodyAlaze/mapbox-nav-expo'
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

  # Mapbox Maps SDK (the MAP only – navigation runs in TypeScript, there is no Navigation SDK anymore).
  # Comes from Swift Package Manager; `spm_dependency` is provided by React Native (>= 0.75) inside the Podfile.
  # 11.26.0 is the newest stable release published on GitHub.
  spm_dependency(s,
    url: 'https://github.com/mapbox/mapbox-maps-ios.git',
    requirement: { kind: 'exactVersion', version: '11.26.0' },
    products: ['MapboxMaps']
  )
end
