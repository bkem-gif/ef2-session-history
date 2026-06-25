# EFUnits — icon → unit mapping

What each image in this folder depicts, verified visually against the in-game art (2026-06-24). 47 icons, one per unit (base + evolved share the same art).

> Note: this **corrects** the partial/incorrect `UNIT_ICON` list previously in `web/history.html` — e.g. `WR`/`WolfWar` were swapped, `HA` was Heavy Armor (it's Hammer Knight), `OF`/`SS` were being borrowed by Orc Flower/Starfish, and Orc Hammerman shared Orc Hunter's `OH`.

| Image | Unit | Class | kindNum(s) |
|---|---|---|---|
| `AM.png` | Abyss Mage | `Abyss1` | 91, 95 |
| `BD.png` | Drums of the Battlefield | `BigDrumer1` | 69, 78 |
| `bomber.png` | Bomber | `Bomber1` | 68, 77 |
| `BP.png` | Bigfoot | `OrcBigFoot1` | 61, 70 |
| `DA.png` | Dark Archer | `DarkArcher1` | 57, 58 |
| `DK.png` | Death Knight | `DeathKnight1` | 59, 60 |
| `DM.png` | Dark Mage | `BlackMage1` | 14, 39 |
| `DS.png` | Dark Sorcerer | `DarkMage1` | 18, 43 |
| `EA.png` | Elf Archer | `ElfArcher1` | 7, 32 |
| `ent.png` | Ent | `Ant1` | 65, 74 |
| `EW.png` | Elf Warrior | `ElfWarrior1` | 8, 33 |
| `EWR.png` | Forest Guardian | `TigerRider1` | 81, 84 |
| `fairy.png` | Fairy | `Fairy1` | 53, 54 |
| `FB.png` | Firebird | `FireBird1` | 3, 28 |
| `FM.png` | Fire Mage | `GreatMage1` | 66, 75 |
| `FrostMage.png` | Frost Mage | `OrcIceMage1` | 21, 46 |
| `GE.png` | Green Eagle | `GreenEagle1` | 11, 36 |
| `Ghost.png` | Ghost | `Ghost1` | 15, 40 |
| `GHU.png` | Great Hammer | `GreatHammer1` | 17, 42 |
| `golem.png` | Golem | `Golem1` | 62, 71 |
| `Gunner.png` | Gunner | `Gunner1` | 4, 29 |
| `HA.png` | Hammer Knight | `HammerKnight1` | 5, 30 |
| `HAU.png` | Heavy Armor | `HeavyWarrior1` | 2, 27 |
| `HEA.png` | High Elf Archer | `HighArcher1` | 10, 35 |
| `HI.png` | Infantry | `FootMan1` | 1, 26 |
| `hod.png` | Hand of Death | `DeathHand1` | 63, 72 |
| `IM.png` | Ice Mage | `OrcBlizzardMage1` | 67, 76 |
| `MU.png` | Mounted Knight | `HorseKnight1` | 6, 31 |
| `nod.png` | Dark Ninja | `DarkNinja1` | 87, 88 |
| `OAU.png` | Orc Axeman | `OrcAxe1` | 23, 48 |
| `OF.png` | Orc Fighter | `OrcFighter1` | 19, 44 |
| `OH.png` | Orc Hunter | `OrcHunter1` | 20, 45 |
| `OHAM.png` | Orc Hammerman | `OrcHammer1` | 24, 49 |
| `OW.png` | Orc Wing | `OrcWing1` | 22, 47 |
| `PA.png` | Poison Archer | `PoisonArcher1` | 9, 34 |
| `priest.png` | Priest | `Priest1` | 55, 56 |
| `SP.png` | Steam Punk | `SteamPunk1` | 82, 85 |
| `SS.png` | Skeleton Soldier | `SkeletonMan1` | 13, 38 |
| `SW.png` | Skeleton Warrior | `SkeletonWarrior1` | 16, 41 |
| `Sylphid.png` | Sylphid | `Sylphid1` | 90, 94 |
| `UK.png` | Unicorn Archer | `Unicorn1` | 51, 52 |
| `WiWa.png` | Wolf Warrior | `WolfWarrior1` | 64, 73 |
| `WK.png` | Winged Knight | `WingKnight1` | 89, 93 |
| `WM.png` | Wind Mage | `WindMage1` | 12, 37 |
| `WolfWar.png` | Wolf Rider | `OrcWolfRider1` | 25, 50 |
| `WR.png` | Raptor Rider | `OrcRapterRider1` | 83, 86 |
| `Wyvern.png` | Wyvern Rider | `WyvernRider1` | 92, 96 |

## `kindNum → image` (corrected — drop-in for `UNIT_ICON`)

```js
UNIT_ICON = {1:"HI", 2:"HAU", 3:"FB", 4:"Gunner", 5:"HA", 6:"MU", 7:"EA", 8:"EW", 9:"PA", 10:"HEA", 11:"GE", 12:"WM", 13:"SS", 14:"DM", 15:"Ghost", 16:"SW", 17:"GHU", 18:"DS", 19:"OF", 20:"OH", 21:"FrostMage", 22:"OW", 23:"OAU", 24:"OHAM", 25:"WolfWar", 26:"HI", 27:"HAU", 28:"FB", 29:"Gunner", 30:"HA", 31:"MU", 32:"EA", 33:"EW", 34:"PA", 35:"HEA", 36:"GE", 37:"WM", 38:"SS", 39:"DM", 40:"Ghost", 41:"SW", 42:"GHU", 43:"DS", 44:"OF", 45:"OH", 46:"FrostMage", 47:"OW", 48:"OAU", 49:"OHAM", 50:"WolfWar", 51:"UK", 52:"UK", 53:"fairy", 54:"fairy", 55:"priest", 56:"priest", 57:"DA", 58:"DA", 59:"DK", 60:"DK", 61:"BP", 62:"golem", 63:"hod", 64:"WiWa", 65:"ent", 66:"FM", 67:"IM", 68:"bomber", 69:"BD", 70:"BP", 71:"golem", 72:"hod", 73:"WiWa", 74:"ent", 75:"FM", 76:"IM", 77:"bomber", 78:"BD", 81:"EWR", 82:"SP", 83:"WR", 84:"EWR", 85:"SP", 86:"WR", 87:"nod", 88:"nod", 89:"WK", 90:"Sylphid", 91:"AM", 92:"Wyvern", 93:"WK", 94:"Sylphid", 95:"AM", 96:"Wyvern"}
```

Units with **no icon** in this set: bosses, enemy minions, summons, and the newest heroes (CrowKnight, Succubus, GriffinRider, BladeMaster, Aladin, Druid). `HAU` (Heavy Armor Ⅱ art) is the only spare.

