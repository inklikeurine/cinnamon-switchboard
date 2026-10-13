# Switchboard

One panel button for the switches you reach for most: Wi-Fi, Bluetooth,
Night Light, Do Not Disturb, power mode and Keep Awake, as a grid of tiles in
a single menu, with a brightness slider on laptops and the battery level at
the bottom.

Click a tile to switch it on or off. Tiles with more to offer have an arrow
strip on their right edge: for Wi-Fi, Bluetooth, Night Light and Power Mode
it opens a page inside the menu (nearby networks, paired devices, colour
temperature, the list of power modes), with a Back button at the top; for Do
Not Disturb it opens the matching page of System Settings. The menu is always the same size, so
the Back button and the footer never move.

## Features

- Two-column tile grid: Wi-Fi, Bluetooth, Night Light, Do Not Disturb, Power
  Mode and Keep Awake, each with a one-line status ("MyNetwork", "1
  connected", "On until 06:00", "Held by Videos" …)
- Wi-Fi page: nearby networks with signal strength and a lock for secured
  ones, the current one marked; click one to connect (a new secured network
  asks for its password in Cinnamon's own dialog); Network Settings below
- Bluetooth page: turn Bluetooth on or off, connect or disconnect paired
  devices, open Bluetooth Settings; a blocked adapter is unblocked when you
  turn Bluetooth on
- Night Light page: on/off, colour temperature slider (1700–6500 K),
  "Disable until tomorrow"
- Power Mode page: the profiles your computer offers, who is holding one,
  and why Performance is missing when it is
- Keep Awake keeps the screen from blanking while it is on, and shows when
  another application is already doing so
- Brightness slider when the screen has a backlight (setting)
- Battery percentage in the footer whenever the computer has a battery
- Tooltip on the panel icon with a one-line summary of everything
- Choose which tiles appear and in which order; tiles for hardware or
  services the computer does not have hide themselves
- Keyboard shortcut to open the menu (default Super+S); Tab and the arrow
  keys move between tiles, Space toggles, Escape goes back a page
- Follows the Cinnamon theme: the "on" colour is the theme's own selection
  colour

## Requirements

- Cinnamon 6.6+ on X11 (Linux Mint 22.3+). Wayland sessions are not supported.
- NetworkManager (`network-manager`, installed by default) for the Wi-Fi tile.
- BlueZ (`bluez`, installed by default) for the Bluetooth tile. `rfkill`
  (`util-linux`) is used to unblock a blocked adapter; without it a blocked
  adapter stays off. `blueman-manager` (`blueman`) is opened by "Bluetooth
  Settings"; without it that row is hidden.
- `power-profiles-daemon` for the Power Mode tile; without it the tile is
  hidden.
- Night Light, brightness and battery come from Cinnamon's own settings
  daemon; each piece hides when its service is not running.

## Install

Copy (or symlink) the applet's inner folder into Cinnamon's user applet
directory, then add it from *System Settings → Applets*:

```sh
cp -r switchboard@inklikeurine/files/switchboard@inklikeurine ~/.local/share/cinnamon/applets/
```

Source: <https://github.com/inklikeurine/cinnamon-applets/tree/main/switchboard@inklikeurine>

## Usage

1. Add **Switchboard** to a panel (*Right-click panel → Applets*).
2. Left-click the icon: the menu opens on its main page. Click a tile to
   switch it, or its arrow strip to open its page. *Back* (or Escape) returns
   to the tiles; *System Settings* at the bottom opens System Settings.
3. Hover the icon for a summary such as "Wi-Fi: MyNetwork · Bluetooth off ·
   DND off · Balanced".
4. *Right-click → Configure…*: on the **Menu** page, reorder or hide tiles
   (the up/down buttons and the Show column) and turn the brightness and
   colour temperature sliders on or off; on the **Shortcuts** page, change
   the key that opens the menu.

## Notes / caveats

- Runtime data: none. Nothing is written to disk; Keep Awake's inhibitor is
  released when the applet is removed or reloaded.
- Network requests: none of its own. Opening the Wi-Fi page asks
  NetworkManager for a Wi-Fi scan (at most once every 10 seconds).
- Wi-Fi: hidden networks are not listed, and enterprise (802.1X) networks
  are set up in Network Settings; both are one click away at the bottom of
  the Wi-Fi page. A network you connect to for the first time is saved by
  NetworkManager like any other.
- Switchboard does not replace the built-in Network, Sound, Night Light or
  Notifications applets; you can keep them or remove the ones it makes
  redundant. Volume is left to the sound applet.
- Power Mode on a desktop: without a CPU or platform driver the daemon
  offers only Power Saver and Balanced, and switching between them changes
  little.
- Keep Awake and *Inhibit Applet* (`inhibit@cinnamon.org`) each show the
  other as "Held by …".
- Pairing new Bluetooth devices is not offered; use Bluetooth Settings.
- Brightness on desktop monitors (DDC/CI) is not supported; see
  `ddcci-multi-monitor@tim-we` or `brightness-and-gamma-applet@cardsurf`.

## AI-generated

This applet was generated by an AI agent under human direction. Use it at
your own risk; read the source before installing.
