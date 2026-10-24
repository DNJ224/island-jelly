# CS2 case opening sound reference

> Don't download or extract game audio. Build with **Web Audio synthesized sounds** or **CC0 / free-licensed** sounds (e.g. freesound.org with a CC0 filter, or kenney.nl UI audio).

## Sequence in game (file names are from asset lists. Timing comes from watching footage and is **unverified**, so measure it against a recording)
1. **Unlock**: `case_unlock_01` (key turns / case opens) plays when you press "Unlock Container". A short mechanical click plus a whoosh, about 0.5–1 s. (Also seen: `case_unlock_immediate_01`.)
2. **Scrolling ticks**: one `case_tick` (old name `crate_item_scroll`) each time an item passes the centre line. Ticks are dense at first and spread out as the reel slows. The whole scroll takes about **5–6 s** (common estimate, unverified) and follows an ease-out curve, so the tick rate tracks the reel speed: play one tick when the centre index changes.
3. **Reveal by rarity**: `case_reveal_rare_01` (blue), `case_reveal_mythical_01` (purple), `case_reveal_legendary_01` (pink), `case_reveal_ancient_01` (red, also used for gold knives; whether knives have a separate sound is unverified). Then the award panel plays `case_awarded_{2..5}_*_01`. Higher rarity sounds longer and fuller.
4. Knives may also have a showcase sound, `item_showcase_knife_01` (unverified whether it plays when opening a case).

## Implementation suggestions (Web Audio)
- Tick: a 1–2 kHz square/triangle wave with 20–30 ms exponential decay, plus a little high-passed noise. Triggered by the reel position. Lower the pitch slightly as the reel slows.
- Unlock: a low-frequency thump (80–120 Hz, 150 ms) plus band-passed noise for the whoosh.
- Reveal: a major chord arpeggio. The higher the rarity, the more notes, the longer the sustain, and the more reverb (blue 0.6 s → red/gold 1.5 s+).
- iOS Safari: create/resume the AudioContext only after the user clicks.

## References
1. CS2 sound path list (Steam guide, includes the `sounds/ui/case_*` / `item_drop*` names): https://steamcommunity.com/sharedfiles/filedetails/?id=3682526480
2. Complete CS2 sound asset list: https://github.com/redBDGR/CS2-Sound-List
3. CS:GO interface sound list (shows `case_unlock_01`, `case_reveal_*_01`, `case_awarded_*`, `crate_item_scroll`, for name reference only, don't download): https://sounds.spriters-resource.com/pc_computer/counterstrikeglobaloffensive/asset/416946/
- For timing, compare against a CS2 case opening recording. Searching YouTube for "CS2 Dreams & Nightmares case opening" works. No specific video has been checked.
