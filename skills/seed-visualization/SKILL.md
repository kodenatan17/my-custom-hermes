---
name: seed-visualization
description: How the Seedly app draws each seed species as an animated procedural potted plant, and the checklist to add or change a species (resolver, blueprint builder, l10n, mock, tests).
---

# Skill: seed-visualization

## Purpose

The Garden pot hero (`PotHeroCarousel`) and the Seed Nursery thumbnails draw each planted seed as a **procedural 3D-ish plant**: geometry is defined in 3D space in code, projected with yaw/pitch, wind-animated and depth-sorted by a `CustomPainter`. There are **no image/3D asset files and no extra packages**. Adding a seed to the catalogue means adding a species here, otherwise it renders as the `generic` plant.

Code lives in `seedly_app/lib/features/garden/presentation/widgets/plant_visual/`.

## When to Use

- A new seed/species is added to the catalogue (CMS/backend) and should look distinct in the pot.
- An existing species' look, growth stages, or name matching needs changing.
- A seed shows the wrong plant (name/latin-name mapping bug).

## When Not to Use

- Pot face, sensors or mood only (`pot_face.dart`, `models/pot_mood.dart`).
- Swapping the whole renderer for Rive or `.glb`: use the `potVisual` override on `PotHeroCarousel` instead of editing species builders.
- Backend or catalogue data changes: spec work, not this skill (see `spec-first`). CMS equivalent: species catalogue screens are under `cms-nextjs-architecture`; there is no CMS equivalent of seed visuals.

## Pipeline (name → pixels)

1. `NurserySeedUiModel` (`models/smart_pot_dashboard_ui_model.dart`): `name`, `latinName`, `growthPct`, optional API `stage`.
2. `PlantSpecies.resolve(name, latinName:)` (`plant_species.dart`) maps free text to a `PlantSpecies` value. **This is the species → visual mapping table.** Latin genus prefix is checked first, then lowercase substring keywords (English + Indonesian). Unknown → `generic`.
3. `PlantGrowthStage.fromApi(stage)` (backend enum `SEED|SEEDLING|VEGETATIVE|FLOWERING`), else `fromGrowthPct` (<10 / <35 / <75 / ≥75). `progressInStage` gives 0–1 inside the stage.
4. `PlantVisualSpec.resolve(...)` (`plant_blueprints.dart`) builds a spec with a stable seed (name hash + slot), then `buildBlueprint` dispatches to `species/<name>.dart`. Results are cached in an LRU (key = species, stage, progress rounded to 0.1, seed).
5. `PottedPlantView` / `PlantThumbnail` render it. The painter projects, sorts and animates every frame; blueprints are never rebuilt per frame.

## Adding a new species: checklist

1. **Resolver** (`plant_species.dart`): add the enum value, its latin genus (or full binomial if the genus has look-alikes, as with `solanum lycopersicum`), and keywords in `_commonNames`.
   - Order matters: more specific keywords before generic ones (mint before chili, so "peppermint" doesn't hit "pepper").
   - Include Indonesian names (e.g. kemangi, selada, cabai, stroberi).
2. **Builder** (`species/<name>.dart`): `PlantBlueprint buildX(PlantGrowthStage stage, double progress, int seed)`.
   - Copy the closest existing species (`mint.dart` for upright stems, `lettuce.dart` for rosettes, `strawberry.dart` for low rosette with fruit, `chili.dart` / `mini_tomato.dart` for fruiting bushes).
   - Use `BlueprintBuilder(seed)`: `stem(...)`, `add(...)`, `jitter`, `between`, `phase`, and `build(sway:)`.
   - **Reuse `buildSeedStage` and `buildSeedlingStage`** from `blueprint_builder.dart` for SEED and SEEDLING; only supply colors and a `trueLeaf` callback. Hand-write only VEGETATIVE and FLOWERING (flowering = vegetative + flowers/fruit).
   - Parts: `StemSegment`, `Leaf.oriented(...)`, `Fruit`, `Flower`, `FlowerSpike`, `SeedHusk` (`plant_geometry.dart`). Coordinates are plant space, unit pot ≈ 1, y up. Always set a per-part `phase: b.phase()` so wind doesn't move everything in lockstep.
   - Randomness only from the builder's `random`, so the same seed gives the same plant.
3. **New shapes only if needed.** Prefer existing `LeafShape` / `FruitKind` / `FlowerKind`. A new shape needs a normalized template in `plant_templates.dart` (built once, then transformed per frame) and a case in the painter.
4. **Dispatch** (`plant_blueprints.dart` `buildBlueprint`): add the `PlantSpecies.x => buildX(...)` arm. The switch is exhaustive, so the compiler flags a missing arm.
5. **l10n**: add `plantSpeciesX` to **both** `lib/l10n/app_en.arb` and `app_id.arb`, run `flutter gen-l10n`, and add the arm in the species-name helper in `potted_plant_view.dart` (used for semantics).
6. **Mock data** (`models/smart_pot_dashboard_ui_model.dart`): add a `NurserySeedUiModel` with the real latin name and put it in one of the `_mockPots`, so it shows up in the carousel in debug (mock is on by default in debug builds).
7. **Tests** (`test/features/garden/presentation/widgets/plant_visual/`):
   - `plant_species_test.dart`: English, Indonesian, latin, and a look-alike that must NOT match.
   - `plant_blueprints_test.dart` iterates `PlantSpecies.values` × all 4 stages, so the new species is covered automatically: non-empty, ≤70 parts per plant, deterministic per seed, flowering taller than seed. Fix the builder if it fails; don't loosen the test.
8. **Look at it.** Render species × stage × a few yaw angles to PNG with a throwaway golden test (keep it in the scratchpad, not the repo), open the PNGs, and iterate until each stage is recognisable and nothing floats or is mis-sorted. Check the 40px thumbnail too.

## Changing an existing species

- Edit only its `species/<name>.dart`. Blueprints are cached by `(species, stage, rounded progress, seed)`, so a hot restart is needed to see geometry changes.
- Keep part count per plant ≤ ~70 (3 plants per pot ≈ 150 parts). Worst case is 3 flowering plants in one pot.

## Constraints

- **No asset files, no new dependencies, no WebView** for this renderer. A different renderer goes through the `potVisual` slot.
- **No per-frame allocation of paths or blueprints**: templates are built once, paints are static, leaves under ~6px skip gloss and veins.
- **Respect `MediaQuery.disableAnimations`**: no running ticker, no fling; tests rely on `pumpAndSettle` completing.
- Presentation-only: never compute growth, stage or health locally. Stage comes from the API (or growth % supplied by it); the app only renders it (see `flutter-client-architecture`).
- Do not add user-facing strings in code. Semantics use the l10n keys.
- Keep `PlantSpecies.resolve` conservative. A wrong confident match (e.g. eggplant drawn as tomato) is worse than `generic`.

## Verification

From `seedly_app/`:

```
flutter gen-l10n
dart format lib test
flutter analyze            # no new issues vs baseline
flutter test test/features/garden test/atomic
```

Then `flutter run` (mock is on by default in debug) and swipe through the pots; use `flutter run --profile` with the performance overlay to check 60fps on a mid-range Android with the heaviest pot.
