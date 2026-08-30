# Achievement art

258 icons, one per achievement, 512×512 PNG with a transparent background.
Tier is carried in the palette — bronze, silver, gold, and so on — so a tile
reads at a glance before you read its name.

## Installing them

Art lives in your **vault**, not in the plugin folder. Copy the icons to:

```
<your vault>/4 System/Game/Achievement Art/
```

or wherever `paths.game` points, if you changed it in Settings → Paths.

Filenames are the achievement's slug. If yours are named differently — or you
generated your own — let the linker sort it out:

```bash
export VAULT=/path/to/your/vault
python3 engine/link-achievement-art.py art/achievements --apply
```

## Making your own

Art is entirely optional. Anything without a file falls back to a tier
medallion, which is a normal state rather than a missing-file error.

`engine/build-icon-prompts.py` writes one generation prompt per achievement,
built from the live catalog so the prompts cannot drift out of step with it:

```bash
python3 engine/build-icon-prompts.py --prompt epic-slayer
```

512×512 with the subject centred works best. The browser renders tiles at 44px
and the unlock popup at about 160px, so 512 covers both on a retina display.
Transparent backgrounds sit better across light and dark themes than a baked-in
panel does.

## Licence

These icons are released under the same MIT licence as the rest of the
repository. They were generated for this project.
