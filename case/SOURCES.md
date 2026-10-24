# Sources: Dreams & Nightmares Case assets

Fetched 2026-10-24 (UTC+8).

## Data
- ByMykel/CSGO-API (https://github.com/ByMykel/CSGO-API)
  - `public/api/en/crates.json`: case `crate-4818` "Dreams & Nightmares Case" (梦魇武器箱), `contains` (17) and `contains_rare` (50 = 30 knife skins, with Gamma Doppler split into Phase 1-4 and Emerald)
  - `public/api/en/skins.json`: float_min/float_max, StatTrak flag, base Gamma Doppler image
  - `public/api/zh-CN/crates.json` / `skins.json`: official Simplified Chinese names (from the game's localisation files)
- The item set was checked against the expected list (17 weapon skins + 5 knives × 6 finishes). **No differences** (see `manifest.json > discrepancies_vs_expected`).

## Images
- Item and case images: Steam Community CDN (`community.akamai.steamstatic.com/economy/image/...`), using the URLs linked from the dataset. The original URL for each image is in `manifest.json > image_source_url`.
- ★ Rare Special Item icon: ByMykel/counter-strike-image-tracker, `static/panorama/images/econ/weapon_cases/default_rare_item_png.png` (extracted from CS2 panorama).
- Gamma Doppler phase images (`*_gamma_doppler_phase_N.png`, `*_gamma_doppler_emerald.png`) are **phase variants** of one item. They're not separate case entries. Phase odds are community estimates, not official.

## Not in this data
- Case drop odds aren't in the dataset. The group uses 79.92 / 15.98 / 3.20 / 0.64 / 0.26 %, which matches Valve's 2017 China disclosure as quoted by third-party sites. The official page itself was not opened.
- The StatTrak rate (commonly said to be 10%) is unverified.

## License note
All images are Valve Corporation's Counter-Strike 2 game assets, © Valve. They're used here only for a non-commercial, personal fan project (a case-opening simulator). They aren't redistributed for profit, and the project isn't affiliated with or endorsed by Valve.
