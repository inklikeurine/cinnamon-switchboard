# Changelog

All notable changes to Switchboard are recorded here. Versions follow
`metadata.json` (`version`), newest first.

## [0.2.0] — 2026-10-12

### Added
- Wi-Fi page: the Wi-Fi tile's arrow opens a list of nearby networks inside
  the menu (signal, lock for secured networks, the current one marked),
  with the Wi-Fi switch at the top and Network Settings at the bottom.
  Click a network to connect: a saved network connects straight away, a new
  secured one asks for its password in Cinnamon's own dialog. Enterprise
  (802.1X) networks open Network Settings to finish the setup. The list
  scrolls and is refreshed with a scan when the page opens.

### Changed
- The Wi-Fi arrow strip opens the Wi-Fi page instead of Network Settings.

## [0.1.1] — 2026-10-12

### Fixed
- Back (and Escape) on a page closed the whole menu instead of returning to
  the tiles. Keyboard focus now moves to the tile that opened the page before
  the page is hidden. The same fix keeps the menu open when a focused tile
  arrow opens its page, and when the power-mode or Bluetooth device list is
  rebuilt under the keyboard focus.
- A Bluetooth device paired with two adapters was listed twice (once
  connected, once not). It is listed once now; connecting tries each adapter
  it is paired with, disconnecting drops every connection.

## [0.1.0] — 2026-10-13

### Added
- First release: two-column tile grid (Wi-Fi, Bluetooth, Night Light, Do Not
  Disturb, Power Mode, Keep Awake) with full-height arrow strips; Bluetooth,
  Night Light and Power Mode pages inside the menu with a Back button and a
  fixed menu height; brightness slider when a backlight exists; battery
  percentage in the footer whenever there is a battery; state summary in
  the tooltip; tile order and visibility, slider and shortcut settings.
